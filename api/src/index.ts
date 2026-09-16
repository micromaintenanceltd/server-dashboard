// MML Server Dashboard API (Cloudflare Worker + Hono).
//
// Route groups:
//   /api/report            agent -> API   (per-server Bearer key, no IP check)
//   /api/servers*  (GET)   technician UI  (IP allowlist)
//   /api/servers*  (write) admin actions  (IP allowlist + admin Bearer token)
//
// See README.md for the full picture.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ReportPayload, ServerRow, ServerStatus, CheckRunPayload } from './types';
import { generateApiKey, hashApiKey, keyPrefix } from './crypto';
import { hashPassword, verifyPassword, signJwt, verifyJwt } from './auth/crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './auth/totp';
import {
  USERS_SCHEMA,
  getUserByEmail,
  getUserById,
  getAuthUser,
  countUsers,
  type UserRow,
  type UserRole,
} from './auth/users';

// Re-export the Durable Object classes so the runtime can find them.
export { ServerState } from './durable/serverState';
export { EnrollLimiter } from './durable/enrollLimiter';

const app = new Hono<{ Bindings: Env }>();

// Permissive CORS: the API is protected by the IP allowlist and (for writes)
// the admin token, so we can allow the dashboard origin freely. Tighten the
// origin list here if you prefer.
app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'] }));

// --- Lightweight self-migration -------------------------------------------
// This Worker deploys via Git, which does not run D1 migrations. To keep schema
// additions safe regardless of deploy order, add any missing columns on the
// first request per isolate. It is a no-op once the column exists.
let schemaEnsured = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaEnsured) return;
  try {
    const col = await db
      .prepare(`SELECT 1 AS ok FROM pragma_table_info('servers') WHERE name = 'desired_state'`)
      .first();
    if (!col) {
      await db.exec(
        `ALTER TABLE servers ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'active'`
      );
    }
    // Users table for the built-in login system. exec() needs one statement per
    // call, so collapse the DDL to a single line.
    await db.exec(USERS_SCHEMA.replace(/\s+/g, ' ').trim());
    schemaEnsured = true;
  } catch {
    // Leave unensured so a later request retries (e.g. table not created yet).
  }
}
app.use('/api/*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

// --- Helpers --------------------------------------------------------------

function staleMinutes(env: Env): number {
  const n = parseInt(env.STALE_AFTER_MINUTES || '15', 10);
  return Number.isNaN(n) ? 15 : n;
}

// Derive a live status from the last time we heard from the server.
//   online  : reported within the stale window
//   stale   : reported within 2x the stale window (amber)
//   offline : longer than that (red)
//   pending : never reported
function computeStatus(lastSeenAt: string | null, staleAfter: number, nowMs: number): ServerStatus {
  if (!lastSeenAt) return 'pending';
  const ageMin = (nowMs - Date.parse(lastSeenAt)) / 60_000;
  if (ageMin <= staleAfter) return 'online';
  if (ageMin <= staleAfter * 2) return 'stale';
  return 'offline';
}

// Guard for technician (read) routes: any signed-in dashboard user.
// Returns the user, or a Response to return on failure.
async function requireUser(c: any): Promise<UserRow | Response> {
  const user = await getAuthUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  return user;
}

// Guard for admin (write) routes: a signed-in user with the admin role.
async function requireAdmin(c: any): Promise<UserRow | Response> {
  const user = await getAuthUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  return user;
}

// --- Health ---------------------------------------------------------------

app.get('/', (c) => c.text('MML Server Dashboard API'));
app.get('/api/health', (c) => c.json({ ok: true, service: 'mml-dashboard-api' }));

// ==========================================================================
// Authentication (built-in login: password + optional TOTP MFA, roles)
// ==========================================================================

const SESSION_TTL = 12 * 3600; // 12 hours
const PREAUTH_TTL = 5 * 60; // 5 minutes to complete MFA
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;

function sessionPayload(u: UserRow) {
  return { kind: 'session', sub: u.id, role: u.role, tv: u.token_version };
}
function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, role: u.role, mfa_enabled: !!u.mfa_enabled };
}
function isValidEmail(e: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}
function passwordProblem(p: string): string | null {
  if (!p || p.length < 10) return 'Password must be at least 10 characters.';
  return null;
}
function genRecoveryCodes(n = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = crypto.getRandomValues(new Uint8Array(5));
    let hex = '';
    for (const x of b) hex += x.toString(16).padStart(2, '0');
    codes.push(`${hex.slice(0, 5)}-${hex.slice(5, 10)}`);
  }
  return codes;
}
async function markLogin(db: D1Database, id: string) {
  await db
    .prepare(`UPDATE users SET last_login_at = ?1 WHERE id = ?2`)
    .bind(new Date().toISOString(), id)
    .run();
}
async function countActiveAdmins(db: D1Database): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0`)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// --- POST /api/auth/setup : create the first admin (bootstrap) ------------
app.post('/api/auth/setup', async (c) => {
  if ((await countUsers(c.env.DB)) > 0) {
    return c.json({ error: 'Setup already completed.' }, 409);
  }
  const token = (c.req.header('Authorization') || '').replace(/^Bearer /, '');
  if (!c.env.BOOTSTRAP_TOKEN || token !== c.env.BOOTSTRAP_TOKEN) {
    return c.json({ error: 'Invalid bootstrap token.' }, 401);
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!isValidEmail(email)) return c.json({ error: 'A valid email is required.' }, 400);
  const pw = passwordProblem(password);
  if (pw) return c.json({ error: pw }, 400);

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?1,?2,?3,'admin',?4)`
  )
    .bind(id, email, hash, new Date().toISOString())
    .run();
  return c.json({ ok: true, user: { id, email, role: 'admin' } }, 201);
});

// --- POST /api/auth/login : password step ---------------------------------
app.post('/api/auth/login', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const invalid = () => c.json({ error: 'Invalid email or password.' }, 401);

  const user = await getUserByEmail(c.env.DB, email);
  if (!user || user.disabled) {
    await hashPassword(password); // equalise timing vs a real verify
    return invalid();
  }
  if (user.lockout_until && Date.parse(user.lockout_until) > Date.now()) {
    return c.json(
      { error: 'Account temporarily locked after too many attempts. Try again shortly.' },
      429
    );
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const attempts = user.failed_attempts + 1;
    const locked = attempts >= MAX_FAILED;
    await c.env.DB.prepare(`UPDATE users SET failed_attempts = ?1, lockout_until = ?2 WHERE id = ?3`)
      .bind(
        locked ? 0 : attempts,
        locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
        user.id
      )
      .run();
    return invalid();
  }

  // Password correct: clear failure counters.
  await c.env.DB.prepare(`UPDATE users SET failed_attempts = 0, lockout_until = NULL WHERE id = ?1`)
    .bind(user.id)
    .run();

  if (user.mfa_enabled) {
    const mfaToken = await signJwt(
      { kind: 'preauth', sub: user.id, tv: user.token_version },
      c.env.AUTH_SECRET,
      PREAUTH_TTL
    );
    return c.json({ mfa_required: true, mfa_token: mfaToken });
  }

  await markLogin(c.env.DB, user.id);
  const token = await signJwt(sessionPayload(user), c.env.AUTH_SECRET, SESSION_TTL);
  return c.json({ token, user: publicUser(user) });
});

// --- POST /api/auth/mfa/verify : TOTP or recovery code --------------------
app.post('/api/auth/mfa/verify', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const payload = await verifyJwt(String(body.mfa_token || ''), c.env.AUTH_SECRET);
  if (!payload || payload.kind !== 'preauth' || !payload.sub) {
    return c.json({ error: 'MFA session expired. Please log in again.' }, 401);
  }
  const user = await getUserById(c.env.DB, String(payload.sub));
  if (!user || user.disabled || !user.mfa_enabled || !user.mfa_secret) {
    return c.json({ error: 'MFA is not available for this account.' }, 400);
  }
  if (Number(payload.tv) !== user.token_version) {
    return c.json({ error: 'Session no longer valid. Log in again.' }, 401);
  }

  const code = String(body.code || '').trim();
  let ok = await verifyTotp(user.mfa_secret, code);
  let usedRecovery = false;
  if (!ok && user.recovery_codes) {
    const hashes: string[] = safeParse(user.recovery_codes, []);
    const codeHash = await hashApiKey(code.replace(/\s/g, '').toLowerCase());
    const idx = hashes.indexOf(codeHash);
    if (idx >= 0) {
      ok = true;
      usedRecovery = true;
      hashes.splice(idx, 1);
      await c.env.DB.prepare(`UPDATE users SET recovery_codes = ?1 WHERE id = ?2`)
        .bind(JSON.stringify(hashes), user.id)
        .run();
    }
  }
  if (!ok) return c.json({ error: 'Invalid code.' }, 401);

  await markLogin(c.env.DB, user.id);
  const token = await signJwt(sessionPayload(user), c.env.AUTH_SECRET, SESSION_TTL);
  return c.json({ token, user: publicUser(user), used_recovery_code: usedRecovery });
});

// --- GET /api/me ----------------------------------------------------------
app.get('/api/me', async (c) => {
  const user = await getAuthUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  return c.json({ user: publicUser(user) });
});

// --- POST /api/auth/password : change own password ------------------------
app.post('/api/auth/password', async (c) => {
  const user = await getAuthUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  if (!(await verifyPassword(String(body.current_password || ''), user.password_hash))) {
    return c.json({ error: 'Current password is incorrect.' }, 400);
  }
  const next = String(body.new_password || '');
  const pw = passwordProblem(next);
  if (pw) return c.json({ error: pw }, 400);

  const hash = await hashPassword(next);
  const newTv = user.token_version + 1;
  await c.env.DB.prepare(`UPDATE users SET password_hash = ?1, token_version = ?2 WHERE id = ?3`)
    .bind(hash, newTv, user.id)
    .run();
  // Keep this browser signed in with a fresh token (older sessions revoked).
  const token = await signJwt(
    { kind: 'session', sub: user.id, role: user.role, tv: newTv },
    c.env.AUTH_SECRET,
    SESSION_TTL
  );
  return c.json({ ok: true, token });
});

// --- MFA setup / enable / disable -----------------------------------------
app.post('/api/auth/mfa/setup', async (c) => {
  const user = await getAuthUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  const secret = generateTotpSecret();
  // Store the pending secret but do not enable until a code is confirmed.
  await c.env.DB.prepare(`UPDATE users SET mfa_secret = ?1, mfa_enabled = 0 WHERE id = ?2`)
    .bind(secret, user.id)
    .run();
  return c.json({ secret, otpauth_uri: otpauthUri(secret, user.email) });
});

app.post('/api/auth/mfa/enable', async (c) => {
  const user = await getAuthUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  if (!user.mfa_secret) return c.json({ error: 'Start MFA setup first.' }, 400);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  if (!(await verifyTotp(user.mfa_secret, String(body.code || '').trim()))) {
    return c.json({ error: 'That code did not match. Check your authenticator and try again.' }, 400);
  }
  const codes = genRecoveryCodes();
  const hashed = await Promise.all(codes.map((x) => hashApiKey(x)));
  await c.env.DB.prepare(`UPDATE users SET mfa_enabled = 1, recovery_codes = ?1 WHERE id = ?2`)
    .bind(JSON.stringify(hashed), user.id)
    .run();
  return c.json({ ok: true, recovery_codes: codes });
});

app.post('/api/auth/mfa/disable', async (c) => {
  const user = await getAuthUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  if (!(await verifyPassword(String(body.password || ''), user.password_hash))) {
    return c.json({ error: 'Password is incorrect.' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, recovery_codes = NULL WHERE id = ?1`
  )
    .bind(user.id)
    .run();
  return c.json({ ok: true });
});

// --- Admin: user management -----------------------------------------------
app.get('/api/users', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, role, mfa_enabled, disabled, created_at, last_login_at
     FROM users ORDER BY email`
  ).all();
  return c.json({
    users: (results as any[]).map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      mfa_enabled: !!u.mfa_enabled,
      disabled: !!u.disabled,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    })),
  });
});

app.post('/api/users', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  const role: UserRole = body.role === 'admin' ? 'admin' : 'tech';
  const password = String(body.password || '');
  if (!isValidEmail(email)) return c.json({ error: 'A valid email is required.' }, 400);
  const pw = passwordProblem(password);
  if (pw) return c.json({ error: pw }, 400);
  if (await getUserByEmail(c.env.DB, email)) {
    return c.json({ error: 'A user with that email already exists.' }, 409);
  }
  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?1,?2,?3,?4,?5)`
  )
    .bind(id, email, hash, role, new Date().toISOString())
    .run();
  return c.json({ ok: true, user: { id, email, role } }, 201);
});

app.post('/api/users/:id/role', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;
  const id = c.req.param('id');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const role: UserRole = body.role === 'admin' ? 'admin' : 'tech';
  if (role === 'tech') {
    const target = await getUserById(c.env.DB, id);
    if (target && target.role === 'admin' && (await countActiveAdmins(c.env.DB)) <= 1) {
      return c.json({ error: 'Cannot demote the last admin.' }, 400);
    }
  }
  await c.env.DB.prepare(`UPDATE users SET role = ?1, token_version = token_version + 1 WHERE id = ?2`)
    .bind(role, id)
    .run();
  return c.json({ ok: true });
});

app.post('/api/users/:id/reset-password', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;
  const id = c.req.param('id');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const pw = passwordProblem(String(body.new_password || ''));
  if (pw) return c.json({ error: pw }, 400);
  const hash = await hashPassword(String(body.new_password));
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?1, token_version = token_version + 1,
      failed_attempts = 0, lockout_until = NULL WHERE id = ?2`
  )
    .bind(hash, id)
    .run();
  return c.json({ ok: true });
});

app.post('/api/users/:id/disable', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;
  const id = c.req.param('id');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const disabled = body.disabled ? 1 : 0;
  if (disabled) {
    const target = await getUserById(c.env.DB, id);
    if (target && target.role === 'admin' && (await countActiveAdmins(c.env.DB)) <= 1) {
      return c.json({ error: 'Cannot disable the last admin.' }, 400);
    }
  }
  await c.env.DB.prepare(`UPDATE users SET disabled = ?1, token_version = token_version + 1 WHERE id = ?2`)
    .bind(disabled, id)
    .run();
  return c.json({ ok: true });
});

app.delete('/api/users/:id', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;
  const id = c.req.param('id');
  if (guard.id === id) return c.json({ error: 'You cannot delete your own account.' }, 400);
  const target = await getUserById(c.env.DB, id);
  if (target && target.role === 'admin' && (await countActiveAdmins(c.env.DB)) <= 1) {
    return c.json({ error: 'Cannot delete the last admin.' }, 400);
  }
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(id).run();
  return c.json({ ok: true, deleted: id });
});

// --- POST /api/report : agent submits a report ----------------------------
app.post('/api/report', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const rawKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!rawKey) return c.json({ error: 'Missing Bearer API key.' }, 401);

  const hash = await hashApiKey(rawKey);
  const server = await c.env.DB.prepare(
    `SELECT * FROM servers WHERE api_key_hash = ?1`
  )
    .bind(hash)
    .first<ServerRow>();

  if (!server) return c.json({ error: 'Invalid API key.' }, 401);

  let payload: ReportPayload;
  try {
    payload = (await c.req.json()) as ReportPayload;
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }

  const reportedAt = new Date().toISOString();

  // 1. Store history row.
  await c.env.DB.prepare(
    `INSERT INTO server_reports
      (server_id, cpu_percent, ram_used_mb, ram_total_mb, disk_json,
       uptime_seconds, services_json, av_status, patch_status, meta_json, reported_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
  )
    .bind(
      server.id,
      numOrNull(payload.cpu_percent),
      numOrNull(payload.ram_used_mb),
      numOrNull(payload.ram_total_mb),
      JSON.stringify(payload.disk ?? []),
      numOrNull(payload.uptime_seconds),
      JSON.stringify(payload.services ?? {}),
      JSON.stringify(payload.av ?? {}),
      JSON.stringify(payload.patch ?? {}),
      JSON.stringify(payload.meta ?? {}),
      reportedAt
    )
    .run();

  // 2. Update roster: mark online and stamp last_seen.
  await c.env.DB.prepare(
    `UPDATE servers SET last_seen_at = ?1, current_status = 'online' WHERE id = ?2`
  )
    .bind(reportedAt, server.id)
    .run();

  // 3. Push the snapshot into the server's Durable Object (live state + alarm).
  const doId = c.env.SERVER_STATE.idFromName(server.id);
  const stub = c.env.SERVER_STATE.get(doId);
  await stub.fetch('https://do/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serverId: server.id,
      report: payload,
      reportedAt,
      staleAfterMinutes: staleMinutes(c.env),
    }),
  });

  // If an admin has marked this server for decommission, tell the agent so it
  // can self-uninstall on this outbound check-in. This is the ONE case where the
  // API's response causes the agent to act, and it is bounded to self-uninstall
  // (never arbitrary commands). See INSTALL.md on the one-directional design.
  const decommission = server.desired_state === 'decommission';

  return c.json({ ok: true, received_at: reportedAt, decommission });
});

// --- DELETE /api/self : agent deregisters its own record ------------------
// Authenticated by the per-server key. Called by the uninstaller (manual or
// decommission) so a removed agent disappears from the dashboard. IP-allowlist
// exempt, like report/enroll, because it comes from the client site.
app.delete('/api/self', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const rawKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!rawKey) return c.json({ error: 'Missing Bearer API key.' }, 401);

  const hash = await hashApiKey(rawKey);
  const server = await c.env.DB.prepare(`SELECT id FROM servers WHERE api_key_hash = ?1`)
    .bind(hash)
    .first<{ id: string }>();
  // Idempotent: if the record is already gone, report success.
  if (!server) return c.json({ ok: true, already_removed: true });

  await c.env.DB.prepare(`DELETE FROM servers WHERE id = ?1`).bind(server.id).run();
  return c.json({ ok: true, deregistered: server.id });
});

// --- POST /api/enroll : installer self-registers a new server -------------
// Authenticated by ENROLL_TOKEN (baked into the signed installer). Like
// /api/report it is exempt from the IP allowlist, because it is called from the
// client site during install, not from the office. It can only create a server
// record and hand back that server's own reporting key.
app.post('/api/enroll', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!c.env.ENROLL_TOKEN || token !== c.env.ENROLL_TOKEN) {
    return c.json({ error: 'Invalid enrollment token.' }, 401);
  }

  // Rate limit via the single global limiter DO.
  const limiterId = c.env.ENROLL_LIMITER.idFromName('global');
  const limiter = c.env.ENROLL_LIMITER.get(limiterId);
  const limitRes = await limiter.fetch('https://do/check');
  const limit = (await limitRes.json()) as { allowed: boolean; retry_after_seconds?: number };
  if (!limit.allowed) {
    return c.json(
      { error: 'Enrollment rate limit reached. Try again shortly.' },
      429,
      { 'Retry-After': String(limit.retry_after_seconds ?? 60) }
    );
  }

  let body: { company_name?: string; hostname?: string; location?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }

  const companyName = (body.company_name || '').trim();
  const hostname = (body.hostname || '').trim();
  if (!companyName || !hostname) {
    return c.json({ error: 'company_name and hostname are required.' }, 400);
  }

  const rawKey = generateApiKey();
  const hash = await hashApiKey(rawKey);
  const prefix = keyPrefix(rawKey);

  // Idempotent on (client_name, name): re-running the installer on the same box
  // for the same company re-provisions it (rotates its key) instead of creating
  // a duplicate record.
  const existing = await c.env.DB.prepare(
    `SELECT id FROM servers WHERE name = ?1 AND client_name = ?2`
  )
    .bind(hostname, companyName)
    .first<{ id: string }>();

  let serverId: string;
  let reenrolled = false;

  if (existing) {
    serverId = existing.id;
    reenrolled = true;
    await c.env.DB.prepare(
      `UPDATE servers SET api_key_hash = ?1, api_key_prefix = ?2, location = COALESCE(?3, location) WHERE id = ?4`
    )
      .bind(hash, prefix, body.location ?? null, serverId)
      .run();
  } else {
    serverId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO servers
         (id, name, client_name, location, api_key_hash, api_key_prefix,
          current_status, created_at, last_seen_at)
       VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,NULL)`
    )
      .bind(serverId, hostname, companyName, body.location ?? null, hash, prefix, new Date().toISOString())
      .run();
  }

  return c.json(
    {
      server_id: serverId,
      name: hostname,
      client_name: companyName,
      api_key: rawKey,
      reenrolled,
    },
    reenrolled ? 200 : 201
  );
});

// --- POST /api/checks : agent submits a weekly check run ------------------
// Same per-server Bearer key as /api/report. Stores the run with per-check
// findings and a computed overall status.
app.post('/api/checks', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const rawKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!rawKey) return c.json({ error: 'Missing Bearer API key.' }, 401);

  const hash = await hashApiKey(rawKey);
  const server = await c.env.DB.prepare(`SELECT id FROM servers WHERE api_key_hash = ?1`)
    .bind(hash)
    .first<{ id: string }>();
  if (!server) return c.json({ error: 'Invalid API key.' }, 401);

  let payload: CheckRunPayload;
  try {
    payload = (await c.req.json()) as CheckRunPayload;
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  if (results.length === 0) {
    return c.json({ error: 'results array is required.' }, 400);
  }

  // Count statuses and derive the overall result: any fail -> fail, else any
  // warn -> warn, else pass.
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === 'fail') fail++;
    else if (r.status === 'warn') warn++;
    else pass++;
  }
  const overall = fail > 0 ? 'fail' : warn > 0 ? 'warn' : 'pass';
  const runAt = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO check_runs
       (server_id, overall_status, pass_count, warn_count, fail_count,
        results_json, agent_version, run_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
  )
    .bind(
      server.id,
      overall,
      pass,
      warn,
      fail,
      JSON.stringify(results),
      payload.agent_version ?? null,
      runAt
    )
    .run();

  return c.json({ ok: true, overall_status: overall, pass, warn, fail, run_at: runAt });
});

// --- GET /api/servers : list all servers with latest status ---------------
app.get('/api/servers', async (c) => {
  const guard = await requireUser(c);
  if (guard instanceof Response) return guard;

  const staleAfter = staleMinutes(c.env);
  const now = Date.now();

  // Roster plus the latest report snapshot and the latest weekly check summary
  // (single query, LEFT JOINs onto the most recent report/check per server).
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.client_name, s.location, s.current_status, s.desired_state,
            s.created_at, s.last_seen_at, s.api_key_prefix,
            r.cpu_percent, r.ram_used_mb, r.ram_total_mb, r.disk_json,
            r.uptime_seconds, r.services_json, r.reported_at,
            cr.overall_status AS check_status, cr.fail_count AS check_fail,
            cr.warn_count AS check_warn, cr.pass_count AS check_pass,
            cr.run_at AS check_run_at
     FROM servers s
     LEFT JOIN server_reports r
       ON r.id = (SELECT id FROM server_reports
                  WHERE server_id = s.id ORDER BY reported_at DESC LIMIT 1)
     LEFT JOIN check_runs cr
       ON cr.id = (SELECT id FROM check_runs
                   WHERE server_id = s.id ORDER BY run_at DESC LIMIT 1)
     ORDER BY s.client_name, s.name`
  ).all();

  const servers = (results as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    client_name: row.client_name,
    location: row.location,
    status: computeStatus(row.last_seen_at, staleAfter, now),
    desired_state: row.desired_state,
    last_seen_at: row.last_seen_at,
    api_key_prefix: row.api_key_prefix,
    latest: row.reported_at
      ? {
          cpu_percent: row.cpu_percent,
          ram_used_mb: row.ram_used_mb,
          ram_total_mb: row.ram_total_mb,
          disk: safeParse(row.disk_json, []),
          uptime_seconds: row.uptime_seconds,
          services: safeParse(row.services_json, {}),
          reported_at: row.reported_at,
        }
      : null,
    latest_check: row.check_run_at
      ? {
          overall_status: row.check_status,
          fail_count: row.check_fail,
          warn_count: row.check_warn,
          pass_count: row.check_pass,
          run_at: row.check_run_at,
        }
      : null,
  }));

  return c.json({ servers, stale_after_minutes: staleAfter });
});

// --- GET /api/servers/:id : detail with recent history --------------------
app.get('/api/servers/:id', async (c) => {
  const guard = await requireUser(c);
  if (guard instanceof Response) return guard;

  const id = c.req.param('id');
  const staleAfter = staleMinutes(c.env);
  const now = Date.now();

  const server = await c.env.DB.prepare(
    `SELECT id, name, client_name, location, current_status, desired_state,
            created_at, last_seen_at, api_key_prefix
     FROM servers WHERE id = ?1`
  )
    .bind(id)
    .first<ServerRow>();

  if (!server) return c.json({ error: 'Server not found.' }, 404);

  // Latest full report.
  const latest = await c.env.DB.prepare(
    `SELECT * FROM server_reports WHERE server_id = ?1 ORDER BY reported_at DESC LIMIT 1`
  )
    .bind(id)
    .first<any>();

  // History for trend charts: last 7 days, thinned client side if needed.
  const sevenDaysAgo = new Date(now - 7 * 24 * 3600_000).toISOString();
  const { results: history } = await c.env.DB.prepare(
    `SELECT cpu_percent, ram_used_mb, ram_total_mb, disk_json, reported_at
     FROM server_reports
     WHERE server_id = ?1 AND reported_at >= ?2
     ORDER BY reported_at ASC`
  )
    .bind(id, sevenDaysAgo)
    .all();

  // Latest weekly check run (full findings).
  const latestCheck = await c.env.DB.prepare(
    `SELECT overall_status, pass_count, warn_count, fail_count, results_json,
            agent_version, run_at
     FROM check_runs WHERE server_id = ?1 ORDER BY run_at DESC LIMIT 1`
  )
    .bind(id)
    .first<any>();

  // Recent check history (summaries only) for a small trend.
  const { results: checkHistory } = await c.env.DB.prepare(
    `SELECT overall_status, pass_count, warn_count, fail_count, run_at
     FROM check_runs WHERE server_id = ?1 ORDER BY run_at DESC LIMIT 12`
  )
    .bind(id)
    .all();

  return c.json({
    server: {
      id: server.id,
      name: server.name,
      client_name: server.client_name,
      location: server.location,
      status: computeStatus(server.last_seen_at, staleAfter, now),
      desired_state: server.desired_state,
      last_seen_at: server.last_seen_at,
      created_at: server.created_at,
      api_key_prefix: server.api_key_prefix,
    },
    latest_check: latestCheck
      ? {
          overall_status: latestCheck.overall_status,
          pass_count: latestCheck.pass_count,
          warn_count: latestCheck.warn_count,
          fail_count: latestCheck.fail_count,
          results: safeParse(latestCheck.results_json, []),
          agent_version: latestCheck.agent_version,
          run_at: latestCheck.run_at,
        }
      : null,
    check_history: (checkHistory as any[]).map((r) => ({
      overall_status: r.overall_status,
      pass_count: r.pass_count,
      warn_count: r.warn_count,
      fail_count: r.fail_count,
      run_at: r.run_at,
    })),
    latest_report: latest
      ? {
          cpu_percent: latest.cpu_percent,
          ram_used_mb: latest.ram_used_mb,
          ram_total_mb: latest.ram_total_mb,
          disk: safeParse(latest.disk_json, []),
          uptime_seconds: latest.uptime_seconds,
          services: safeParse(latest.services_json, {}),
          av: safeParse(latest.av_status, {}),
          patch: safeParse(latest.patch_status, {}),
          meta: safeParse(latest.meta_json, {}),
          reported_at: latest.reported_at,
        }
      : null,
    history: (history as any[]).map((h) => ({
      cpu_percent: h.cpu_percent,
      ram_used_mb: h.ram_used_mb,
      ram_total_mb: h.ram_total_mb,
      disk: safeParse(h.disk_json, []),
      reported_at: h.reported_at,
    })),
    stale_after_minutes: staleAfter,
  });
});

// --- POST /api/servers : admin creates a server + generates a key ---------
app.post('/api/servers', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;

  let body: { name?: string; client_name?: string; location?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }

  if (!body.name || !body.client_name) {
    return c.json({ error: 'name and client_name are required.' }, 400);
  }

  const id = crypto.randomUUID();
  const rawKey = generateApiKey();
  const hash = await hashApiKey(rawKey);
  const prefix = keyPrefix(rawKey);
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO servers
       (id, name, client_name, location, api_key_hash, api_key_prefix,
        current_status, created_at, last_seen_at)
     VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,NULL)`
  )
    .bind(id, body.name, body.client_name, body.location ?? null, hash, prefix, createdAt)
    .run();

  // The raw key is returned exactly once; it is not recoverable later.
  return c.json(
    {
      server: { id, name: body.name, client_name: body.client_name, location: body.location ?? null },
      api_key: rawKey,
      note: 'Store this key now. It is shown once and cannot be retrieved later.',
    },
    201
  );
});

// --- DELETE /api/servers/:id : admin force-removes a server immediately ---
// Removes the record now, regardless of the agent. Use for servers that are
// already gone/offline. The agent (if still installed) will get 401s and go
// dormant. For a graceful removal that also uninstalls the agent, use
// /decommission below.
app.delete('/api/servers/:id', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT id FROM servers WHERE id = ?1`)
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'Server not found.' }, 404);

  // ON DELETE CASCADE removes the report history too.
  await c.env.DB.prepare(`DELETE FROM servers WHERE id = ?1`).bind(id).run();
  return c.json({ ok: true, deleted: id });
});

// --- POST /api/servers/:id/decommission : admin asks the agent to uninstall -
// Marks the server for decommission. On its next report the agent sees the flag
// and self-uninstalls, which deregisters and removes the record. The record
// stays visible (as "decommissioning") until the agent checks in and completes;
// force-remove it with DELETE above if the agent never comes back.
app.post('/api/servers/:id/decommission', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT id FROM servers WHERE id = ?1`)
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'Server not found.' }, 404);

  await c.env.DB.prepare(`UPDATE servers SET desired_state = 'decommission' WHERE id = ?1`)
    .bind(id)
    .run();
  return c.json({
    ok: true,
    server_id: id,
    note: 'Marked for decommission. The agent will uninstall on its next check-in.',
  });
});

// --- POST /api/servers/:id/rotate-key : admin revokes + reissues a key ----
app.post('/api/servers/:id/rotate-key', async (c) => {
  const guard = await requireAdmin(c);
  if (guard instanceof Response) return guard;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT id FROM servers WHERE id = ?1`)
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'Server not found.' }, 404);

  const rawKey = generateApiKey();
  const hash = await hashApiKey(rawKey);
  const prefix = keyPrefix(rawKey);

  await c.env.DB.prepare(
    `UPDATE servers SET api_key_hash = ?1, api_key_prefix = ?2 WHERE id = ?3`
  )
    .bind(hash, prefix, id)
    .run();

  return c.json({
    server_id: id,
    api_key: rawKey,
    note: 'Old key is now revoked. Update the agent on that server with this new key.',
  });
});

// --- utilities ------------------------------------------------------------

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function safeParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export default app;
