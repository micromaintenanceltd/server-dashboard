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
import { bodyLimit } from 'hono/body-limit';
import type { Env, ReportPayload, ServerRow, ServerStatus, CheckRunPayload } from './types';
import { generateApiKey, hashApiKey, keyPrefix } from './crypto';
import { hashPassword, verifyPassword, signJwt, verifyJwt, timingSafeEqual } from './auth/crypto';
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
import {
  loadAlertConfig,
  deliver,
  evaluateAlert,
  freshdeskReady,
  freshdeskTestTicket,
  canSendEmail,
  resendSend,
  esc,
} from './alerts';

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
    // Users table for the built-in login system. Use prepare().run() (one
    // statement, no trailing semicolon) - remote D1's exec() is unreliable here.
    await db.prepare(USERS_SCHEMA.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()).run();
    // Per-company logos (keyed by client name) shown next to each device.
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS client_logos (client_name TEXT PRIMARY KEY, data_url TEXT NOT NULL, updated_at TEXT NOT NULL)`
      )
      .run();
    // Alerting: a single-row config table and a per-(server,kind) state table
    // used to fire only on transitions (bad <-> recovered).
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS alert_config (id INTEGER PRIMARY KEY, teams_webhook_url TEXT, email_to TEXT, email_from TEXT, email_api_key TEXT, freshdesk_domain TEXT, freshdesk_api_key TEXT, freshdesk_email TEXT, freshdesk_group_id TEXT, on_check_fail INTEGER NOT NULL DEFAULT 1, on_offline INTEGER NOT NULL DEFAULT 1, on_crit_stopped INTEGER NOT NULL DEFAULT 1, updated_at TEXT)`
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS alert_state (server_id TEXT NOT NULL, kind TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, ref TEXT, updated_at TEXT, PRIMARY KEY (server_id, kind))`
      )
      .run();
    // Agent auto-update control plane: a single row holding the latest published
    // agent version plus whether it is approved for rollout (enabled). Servers
    // read this (when enabled) to self-update; publishing sets enabled=0 so a new
    // version is never deployed until an admin approves it.
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS agent_release (id INTEGER PRIMARY KEY, version TEXT, download_url TEXT, sha256 TEXT, enabled INTEGER NOT NULL DEFAULT 0, notes TEXT, updated_at TEXT)`
      )
      .run();
    // Columns added after the alert tables first shipped (Freshdesk channel +
    // the ticket-ref on alert_state). Table/column names are fixed literals.
    const addColumns: [string, string][] = [
      ['alert_config', 'freshdesk_domain'],
      ['alert_config', 'freshdesk_api_key'],
      ['alert_config', 'freshdesk_email'],
      ['alert_config', 'freshdesk_group_id'],
      ['alert_state', 'ref'],
      ['server_reports', 'pings_json'], // LAN ping-monitor results per report
    ];
    for (const [table, col] of addColumns) {
      const exists = await db
        .prepare(`SELECT 1 AS ok FROM pragma_table_info('${table}') WHERE name = '${col}'`)
        .first();
      if (!exists) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`).run();
    }
    // Alert toggle for ping-down (integer; added after alert_config shipped).
    const pingCol = await db
      .prepare(`SELECT 1 AS ok FROM pragma_table_info('alert_config') WHERE name = 'on_ping_down'`)
      .first();
    if (!pingCol) {
      await db.prepare(`ALTER TABLE alert_config ADD COLUMN on_ping_down INTEGER NOT NULL DEFAULT 1`).run();
    }
    schemaEnsured = true;
  } catch {
    // Leave unensured so a later request retries (e.g. table not created yet).
  }
}
app.use('/api/*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

// Cap request bodies on the agent-facing ingest endpoints so a holder of a
// per-server key cannot exhaust storage/CPU with huge payloads.
app.use(
  '/api/report',
  bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.json({ error: 'Report too large.' }, 413) })
);
app.use(
  '/api/checks',
  bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'Payload too large.' }, 413) })
);

// --- Helpers --------------------------------------------------------------

const textEncoder = new TextEncoder();

// Constant-time comparison of two secret strings (avoids a byte-by-byte timing
// side channel when checking the enrollment / bootstrap tokens).
function secretEquals(a: string, b: string): boolean {
  return timingSafeEqual(textEncoder.encode(a), textEncoder.encode(b));
}

// Per-IP fixed-window throttle, reusing the EnrollLimiter DO under a distinct
// key. Returns true when the caller has exceeded the window. Never throws - a
// limiter failure must not lock people out.
async function rateLimited(c: any, bucket: string): Promise<boolean> {
  try {
    const ip =
      c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const id = c.env.ENROLL_LIMITER.idFromName(`${bucket}:${ip}`);
    const r = await c.env.ENROLL_LIMITER.get(id).fetch('https://limiter/');
    const j: any = await r.json();
    return j && j.allowed === false;
  } catch {
    return false;
  }
}

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
// Per-company logos (shown next to each device). Keyed by client name.
// Read: any signed-in user. Write: admin only. Logos are stored as small
// base64 image data URLs (the dashboard resizes before upload).
// ==========================================================================

const MAX_LOGO_CHARS = 256 * 1024; // ~190 KB image; UI resizes to ~128px first
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

app.get('/api/client-logos', async (c) => {
  const u = await requireUser(c);
  if (u instanceof Response) return u;
  const { results } = await c.env.DB.prepare(
    'SELECT client_name, data_url FROM client_logos'
  ).all<{ client_name: string; data_url: string }>();
  const logos: Record<string, string> = {};
  for (const row of results ?? []) logos[row.client_name] = row.data_url;
  return c.json({ logos });
});

app.post('/api/client-logos', async (c) => {
  const u = await requireAdmin(c);
  if (u instanceof Response) return u;
  let body: { client_name?: string; data_url?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const client = (body.client_name || '').trim();
  if (!client) return c.json({ error: 'client_name is required.' }, 400);

  // Empty/null data_url clears the logo.
  if (body.data_url == null || body.data_url === '') {
    await c.env.DB.prepare('DELETE FROM client_logos WHERE client_name = ?1').bind(client).run();
    return c.json({ ok: true, deleted: client });
  }
  const dataUrl = body.data_url;
  if (typeof dataUrl !== 'string' || !LOGO_DATA_URL.test(dataUrl)) {
    return c.json({ error: 'data_url must be a base64 PNG/JPEG/WebP data URL.' }, 400);
  }
  if (dataUrl.length > MAX_LOGO_CHARS) {
    return c.json({ error: 'Logo is too large (max ~190 KB after resize).' }, 413);
  }
  await c.env.DB.prepare(
    `INSERT INTO client_logos (client_name, data_url, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(client_name) DO UPDATE SET data_url = excluded.data_url, updated_at = excluded.updated_at`
  )
    .bind(client, dataUrl, new Date().toISOString())
    .run();
  return c.json({ ok: true, client_name: client });
});

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
  if (!c.env.BOOTSTRAP_TOKEN || !secretEquals(token, c.env.BOOTSTRAP_TOKEN)) {
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
  if (await rateLimited(c, 'login')) {
    return c.json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
  }
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
  if (await rateLimited(c, 'mfa')) {
    return c.json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
  }
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

  // Email the new user an invite with the dashboard link and their temporary
  // login details (best-effort; falls back to the admin sharing them manually).
  // The dashboard URL is the origin the admin is creating them from.
  let emailed = false;
  let emailError: string | null = null;
  const sendInvite = body.send_invite !== false; // default on
  if (sendInvite) {
    try {
      const cfg = await loadAlertConfig(c.env.DB);
      if (!canSendEmail(cfg)) {
        emailError = 'Email is not configured (set From + Resend key under Alerts).';
      } else {
        const origin = (c.req.header('origin') || '').replace(/\/+$/, '');
        const loginUrl = origin ? `${origin}/login/` : '';
        await resendSend(cfg, [email], 'Your MML Dashboard account', inviteHtml(loginUrl, email, password, role));
        emailed = true;
      }
    } catch (e: any) {
      emailError = e?.message || 'Email failed to send.';
    }
  }

  return c.json({ ok: true, user: { id, email, role }, emailed, email_error: emailError }, 201);
});

function inviteHtml(loginUrl: string, email: string, tempPassword: string, role: UserRole): string {
  const linkLine = loginUrl
    ? `<p>Sign in here: <a href="${esc(loginUrl)}">${esc(loginUrl)}</a></p>`
    : `<p>Sign in at your MML dashboard URL.</p>`;
  return (
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a">` +
    `<h2 style="margin:0 0 10px">MML Dashboard — your account</h2>` +
    `<p>An administrator has created a ${esc(role === 'admin' ? 'administrator' : 'technician')} account for you on the Micro Maintenance monitoring dashboard.</p>` +
    linkLine +
    `<p style="margin:14px 0;padding:12px 14px;background:#f1f5f9;border-radius:8px">` +
    `<strong>Email:</strong> ${esc(email)}<br/>` +
    `<strong>Temporary password:</strong> ${esc(tempPassword)}</p>` +
    `<p>Please sign in and change your password straight away (Security page), and set up two-factor authentication.</p>` +
    `<p style="color:#64748b;font-size:12px">If you weren't expecting this, you can ignore this email.</p>` +
    `</div>`
  );
}

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
       uptime_seconds, services_json, av_status, patch_status, meta_json, pings_json, reported_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
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
      JSON.stringify(payload.pings ?? []),
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

  // Alerts (after the response, so reporting latency is unaffected): a report
  // means the device is online, so clear any offline alert; and raise/clear the
  // critical-service-stopped alert from this snapshot.
  const stopped = Array.isArray(payload.services?.stopped_critical)
    ? (payload.services!.stopped_critical as string[])
    : [];
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const cfg = await loadAlertConfig(c.env.DB);
        // A report means the device is online -> clear any offline alert.
        await evaluateAlert(c.env.DB, cfg, {
          serverId: server.id,
          serverName: server.name,
          clientName: server.client_name,
          kind: 'offline',
          bad: false,
        });
        // Critical-service-stopped is tracked PER SERVICE (stateKey crit:<name>)
        // so each stopped service alerts and recovers independently.
        for (const name of stopped) {
          await evaluateAlert(c.env.DB, cfg, {
            serverId: server.id,
            serverName: server.name,
            clientName: server.client_name,
            kind: 'crit',
            stateKey: `crit:${name}`,
            bad: true,
            detail: name,
          });
        }
        // Recover any previously-stopped critical service no longer in the list.
        const activeCrit = await c.env.DB.prepare(
          `SELECT kind FROM alert_state WHERE server_id = ?1 AND kind LIKE 'crit:%' AND active = 1`
        )
          .bind(server.id)
          .all<{ kind: string }>();
        for (const row of activeCrit.results ?? []) {
          const svc = row.kind.slice('crit:'.length);
          if (!stopped.includes(svc)) {
            await evaluateAlert(c.env.DB, cfg, {
              serverId: server.id,
              serverName: server.name,
              clientName: server.client_name,
              kind: 'crit',
              stateKey: row.kind,
              bad: false,
              detail: svc,
            });
          }
        }

        // LAN ping monitors: alert per target (stateKey ping:<name>) when it
        // stops responding, and recover when it responds again (or is removed).
        const pings = Array.isArray(payload.pings) ? payload.pings : [];
        const downNames = new Set(
          pings.filter((p) => p && p.ok === false).map((p) => String(p.name))
        );
        for (const p of pings) {
          if (p && p.ok === false) {
            await evaluateAlert(c.env.DB, cfg, {
              serverId: server.id,
              serverName: server.name,
              clientName: server.client_name,
              kind: 'ping',
              stateKey: `ping:${p.name}`,
              bad: true,
              detail: `${p.name} (${p.host})`,
            });
          }
        }
        const activePing = await c.env.DB.prepare(
          `SELECT kind FROM alert_state WHERE server_id = ?1 AND kind LIKE 'ping:%' AND active = 1`
        )
          .bind(server.id)
          .all<{ kind: string }>();
        for (const row of activePing.results ?? []) {
          const name = row.kind.slice('ping:'.length);
          if (!downNames.has(name)) {
            await evaluateAlert(c.env.DB, cfg, {
              serverId: server.id,
              serverName: server.name,
              clientName: server.client_name,
              kind: 'ping',
              stateKey: row.kind,
              bad: false,
              detail: name,
            });
          }
        }
      } catch {
        // alerts must never affect ingest
      }
    })()
  );

  // If an admin has marked this server for decommission, tell the agent so it
  // can self-uninstall on this outbound check-in. This is the ONE case where the
  // API's response causes the agent to act, and it is bounded to self-uninstall
  // (never arbitrary commands). See INSTALL.md on the one-directional design.
  const decommission = server.desired_state === 'decommission';

  return c.json({ ok: true, received_at: reportedAt, decommission });
});

// --- POST /api/verify-settings-password -----------------------------------
// An agent calls this (with its per-server key) to check the settings password
// a technician typed on the local settings page, against the SETTINGS_PASSWORD
// secret. The password itself never lives on the agent or on disk.
app.post('/api/verify-settings-password', async (c) => {
  if (await rateLimited(c, 'verifypw')) {
    return c.json({ ok: false, error: 'Too many attempts. Please wait a moment.' }, 429);
  }
  const auth = c.req.header('Authorization') || '';
  const rawKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!rawKey) return c.json({ ok: false, error: 'Missing Bearer API key.' }, 401);
  const hash = await hashApiKey(rawKey);
  const server = await c.env.DB.prepare(`SELECT id FROM servers WHERE api_key_hash = ?1`)
    .bind(hash)
    .first<{ id: string }>();
  if (!server) return c.json({ ok: false, error: 'Invalid API key.' }, 401);

  let body: { password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Body must be valid JSON.' }, 400);
  }
  const expected = c.env.SETTINGS_PASSWORD || '';
  if (!expected) {
    return c.json({ ok: false, error: 'No settings password is configured on the server.' }, 400);
  }
  const ok = secretEquals(String(body.password || ''), expected);
  return c.json({ ok });
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
  if (!c.env.ENROLL_TOKEN || !secretEquals(token, c.env.ENROLL_TOKEN)) {
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
  const server = await c.env.DB.prepare(
    `SELECT id, name, client_name FROM servers WHERE api_key_hash = ?1`
  )
    .bind(hash)
    .first<{ id: string; name: string; client_name: string }>();
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
  if (results.length > 200) {
    return c.json({ error: 'Too many check results (max 200).' }, 413);
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

  // Alert on the fail<->pass transition (after the response).
  const failedTitles = results
    .filter((r) => r.status === 'fail')
    .map((r) => r.title)
    .filter(Boolean)
    .join(', ');
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const cfg = await loadAlertConfig(c.env.DB);
        await evaluateAlert(c.env.DB, cfg, {
          serverId: server.id,
          serverName: server.name,
          clientName: server.client_name,
          kind: 'check',
          bad: fail > 0,
          detail: failedTitles,
        });
      } catch {
        // alerts must never affect ingest
      }
    })()
  );

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
            r.uptime_seconds, r.services_json, r.meta_json, r.pings_json, r.reported_at,
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
    agent_version: safeParse<{ agent_version?: string }>(row.meta_json, {}).agent_version ?? null,
    latest: row.reported_at
      ? {
          cpu_percent: row.cpu_percent,
          ram_used_mb: row.ram_used_mb,
          ram_total_mb: row.ram_total_mb,
          disk: safeParse(row.disk_json, []),
          uptime_seconds: row.uptime_seconds,
          services: safeParse(row.services_json, {}),
          pings: safeParse(row.pings_json, []),
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
          pings: safeParse(latest.pings_json, []),
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

// --- GET /api/servers/:id/uptime : 30-day outage timeline -----------------
// Returns the device's downtime windows over the last 30 days, derived from
// gaps between its reports (a gap longer than the stale window = offline). The
// client buckets these into local-day blocks. Payload is tiny (just the gaps),
// so this stays cheap even though it scans 30 days of report timestamps.
app.get('/api/servers/:id/uptime', async (c) => {
  const guard = await requireUser(c);
  if (guard instanceof Response) return guard;

  const id = c.req.param('id');
  const staleMin = staleMinutes(c.env);
  const now = Date.now();
  const days = 30;
  const windowStart = now - days * 24 * 3600_000;

  const { results } = await c.env.DB.prepare(
    `SELECT reported_at FROM server_reports
     WHERE server_id = ?1 AND reported_at >= ?2
     ORDER BY reported_at ASC`
  )
    .bind(id, new Date(windowStart).toISOString())
    .all<{ reported_at: string }>();

  const times = (results ?? [])
    .map((r) => Date.parse(r.reported_at))
    .filter((t) => !isNaN(t));

  // A gap bigger than the stale window counts as an outage between those reports.
  const gapMs = staleMin * 60_000;
  const outages: { start: number; end: number; ongoing?: boolean }[] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > gapMs) outages.push({ start: times[i - 1], end: times[i] });
  }
  const firstReport = times.length ? times[0] : null;
  const lastReport = times.length ? times[times.length - 1] : null;
  // Still down now if we haven't heard from it within the stale window.
  if (lastReport != null && now - lastReport > gapMs) {
    outages.push({ start: lastReport, end: now, ongoing: true });
  }

  return c.json({ staleMinutes: staleMin, windowStart, now, firstReport, lastReport, outages });
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

// ==========================================================================
// Alert configuration (admin). Secrets (Teams webhook URL, email API key) are
// never returned to the browser - only whether they are set. Blank on save
// keeps the existing value; clear_* removes it.
// ==========================================================================

app.get('/api/alert-config', async (c) => {
  const u = await requireAdmin(c);
  if (u instanceof Response) return u;
  const cfg = await loadAlertConfig(c.env.DB);
  return c.json({
    teams_set: !!cfg.teams_webhook_url,
    email_key_set: !!cfg.email_api_key,
    email_to: cfg.email_to ?? '',
    email_from: cfg.email_from ?? '',
    freshdesk_key_set: !!cfg.freshdesk_api_key,
    freshdesk_domain: cfg.freshdesk_domain ?? '',
    freshdesk_email: cfg.freshdesk_email ?? '',
    freshdesk_group_id: cfg.freshdesk_group_id ?? '',
    on_check_fail: cfg.on_check_fail,
    on_offline: cfg.on_offline,
    on_crit_stopped: cfg.on_crit_stopped,
    on_ping_down: cfg.on_ping_down,
  });
});

app.post('/api/alert-config', async (c) => {
  const u = await requireAdmin(c);
  if (u instanceof Response) return u;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const cur = await loadAlertConfig(c.env.DB);

  let teams = cur.teams_webhook_url;
  if (body.clear_teams) teams = null;
  else if (typeof body.teams_webhook_url === 'string' && body.teams_webhook_url.trim())
    teams = body.teams_webhook_url.trim();

  let emailKey = cur.email_api_key;
  if (body.clear_email_key) emailKey = null;
  else if (typeof body.email_api_key === 'string' && body.email_api_key.trim())
    emailKey = body.email_api_key.trim();

  let fdKey = cur.freshdesk_api_key;
  if (body.clear_freshdesk_key) fdKey = null;
  else if (typeof body.freshdesk_api_key === 'string' && body.freshdesk_api_key.trim())
    fdKey = body.freshdesk_api_key.trim();

  const emailTo = typeof body.email_to === 'string' ? body.email_to.trim() || null : cur.email_to;
  const emailFrom =
    typeof body.email_from === 'string' ? body.email_from.trim() || null : cur.email_from;
  const fdDomain =
    typeof body.freshdesk_domain === 'string'
      ? body.freshdesk_domain.trim() || null
      : cur.freshdesk_domain;
  const fdEmail =
    typeof body.freshdesk_email === 'string' ? body.freshdesk_email.trim() || null : cur.freshdesk_email;
  const fdGroup =
    typeof body.freshdesk_group_id === 'string'
      ? body.freshdesk_group_id.trim() || null
      : cur.freshdesk_group_id;
  const onCheck = body.on_check_fail === undefined ? cur.on_check_fail : !!body.on_check_fail;
  const onOffline = body.on_offline === undefined ? cur.on_offline : !!body.on_offline;
  const onCrit = body.on_crit_stopped === undefined ? cur.on_crit_stopped : !!body.on_crit_stopped;
  const onPing = body.on_ping_down === undefined ? cur.on_ping_down : !!body.on_ping_down;

  if (teams && !/^https:\/\//i.test(teams)) {
    return c.json({ error: 'Teams webhook must be an https URL.' }, 400);
  }
  if (fdGroup && !/^\d+$/.test(fdGroup)) {
    return c.json({ error: 'Freshdesk group id must be numeric.' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO alert_config
       (id, teams_webhook_url, email_to, email_from, email_api_key, freshdesk_domain, freshdesk_api_key, freshdesk_email, freshdesk_group_id, on_check_fail, on_offline, on_crit_stopped, on_ping_down, updated_at)
     VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(id) DO UPDATE SET
       teams_webhook_url = excluded.teams_webhook_url,
       email_to = excluded.email_to,
       email_from = excluded.email_from,
       email_api_key = excluded.email_api_key,
       freshdesk_domain = excluded.freshdesk_domain,
       freshdesk_api_key = excluded.freshdesk_api_key,
       freshdesk_email = excluded.freshdesk_email,
       freshdesk_group_id = excluded.freshdesk_group_id,
       on_check_fail = excluded.on_check_fail,
       on_offline = excluded.on_offline,
       on_crit_stopped = excluded.on_crit_stopped,
       on_ping_down = excluded.on_ping_down,
       updated_at = excluded.updated_at`
  )
    .bind(
      teams,
      emailTo,
      emailFrom,
      emailKey,
      fdDomain,
      fdKey,
      fdEmail,
      fdGroup,
      onCheck ? 1 : 0,
      onOffline ? 1 : 0,
      onCrit ? 1 : 0,
      onPing ? 1 : 0,
      new Date().toISOString()
    )
    .run();

  return c.json({ ok: true });
});

app.post('/api/alert-config/test', async (c) => {
  const u = await requireAdmin(c);
  if (u instanceof Response) return u;
  const cfg = await loadAlertConfig(c.env.DB);
  const emailReady = !!(cfg.email_to && cfg.email_from && cfg.email_api_key);
  const fdReady = freshdeskReady(cfg);
  if (!cfg.teams_webhook_url && !emailReady && !fdReady) {
    return c.json(
      { error: 'No channel configured. Add a Teams webhook, email, or Freshdesk settings, then Save first.' },
      400
    );
  }
  // Teams/email get a real test message; Freshdesk is only credential-checked
  // (we don't want a stray test ticket in the helpdesk).
  const r = await deliver(cfg, {
    severity: 'good',
    title: 'MML Dashboard — test alert',
    lines: [
      'This is a test alert from the MML dashboard.',
      'If you can see this, alerting is configured correctly.',
    ],
  });
  let freshdesk: boolean | null = null;
  let freshdeskTicket: string | null = null;
  const errors = [...r.errors];
  if (fdReady) {
    try {
      freshdeskTicket = await freshdeskTestTicket(cfg);
      freshdesk = true;
    } catch (e: any) {
      freshdesk = false;
      errors.push(`Freshdesk: ${e?.message || e}`);
    }
  }
  return c.json({
    ok: errors.length === 0,
    teams: r.teams,
    email: r.email,
    freshdesk,
    freshdesk_ticket: freshdeskTicket,
    errors,
  });
});

// ==========================================================================
// Agent auto-update control plane
//   GET  /api/agent/latest          (server key)   -> approved version, if any
//   POST /api/agent/release         (RELEASE_TOKEN) -> publish a new version
//   GET  /api/agent/release         (admin)         -> current release + status
//   POST /api/agent/release/enabled (admin)         -> approve / kill switch
// ==========================================================================

interface AgentReleaseRow {
  version: string | null;
  download_url: string | null;
  sha256: string | null;
  enabled: number;
  notes: string | null;
  updated_at: string | null;
}

async function loadAgentRelease(db: D1Database): Promise<AgentReleaseRow | null> {
  return db
    .prepare(
      'SELECT version, download_url, sha256, enabled, notes, updated_at FROM agent_release WHERE id = 1'
    )
    .first<AgentReleaseRow>();
}

// An agent (per-server key) asks which version is approved for rollout. We only
// reveal the download details when a version is enabled, so a pending (not yet
// approved) release is invisible to the fleet.
app.get('/api/agent/latest', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const rawKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!rawKey) return c.json({ error: 'Missing Bearer API key.' }, 401);
  const hash = await hashApiKey(rawKey);
  const server = await c.env.DB.prepare('SELECT id FROM servers WHERE api_key_hash = ?1')
    .bind(hash)
    .first<{ id: string }>();
  if (!server) return c.json({ error: 'Invalid API key.' }, 401);

  const rel = await loadAgentRelease(c.env.DB);
  if (!rel || !rel.enabled || !rel.version) return c.json({ enabled: false });
  return c.json({
    enabled: true,
    version: rel.version,
    downloadUrl: rel.download_url,
    sha256: rel.sha256,
  });
});

// Publish a newly-built version. Authenticated with the RELEASE_TOKEN secret
// (not a dashboard login), so the build script can post without admin creds.
// A new version is always stored as PENDING (enabled=0): an admin must approve
// it in the dashboard before any server installs it. Re-publishing the SAME
// version keeps its current enabled flag (lets you re-upload without un-approving).
app.post('/api/agent/release', async (c) => {
  const expected = c.env.RELEASE_TOKEN || '';
  if (!expected) return c.json({ error: 'Publishing is not configured (no RELEASE_TOKEN).' }, 400);
  const auth = c.req.header('Authorization') || '';
  const rawTok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!rawTok || !secretEquals(rawTok, expected)) {
    return c.json({ error: 'Invalid release token.' }, 401);
  }

  let body: { version?: string; downloadUrl?: string; sha256?: string; notes?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const version = String(body.version || '').trim();
  const downloadUrl = String(body.downloadUrl || '').trim();
  const sha256 = String(body.sha256 || '').trim().toLowerCase();
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null;

  if (!/^\d+(\.\d+){1,3}$/.test(version)) {
    return c.json({ error: 'version must be a dotted numeric version, e.g. 0.3.9.' }, 400);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return c.json({ error: 'sha256 must be a 64-character hex string.' }, 400);
  }
  let host = '';
  try {
    const u = new URL(downloadUrl);
    host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:') throw new Error('not https');
  } catch {
    return c.json({ error: 'downloadUrl must be a valid https URL.' }, 400);
  }
  const ghOk = host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com');
  if (!ghOk) {
    return c.json({ error: 'downloadUrl must be a GitHub release URL.' }, 400);
  }

  const cur = await loadAgentRelease(c.env.DB);
  // Keep the enabled flag only when re-publishing the exact same version.
  const keepEnabled = cur && cur.version === version ? cur.enabled : 0;

  await c.env.DB.prepare(
    `INSERT INTO agent_release (id, version, download_url, sha256, enabled, notes, updated_at)
     VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET
       version = excluded.version,
       download_url = excluded.download_url,
       sha256 = excluded.sha256,
       enabled = excluded.enabled,
       notes = excluded.notes,
       updated_at = excluded.updated_at`
  )
    .bind(version, downloadUrl, sha256, keepEnabled, notes, new Date().toISOString())
    .run();

  return c.json({ ok: true, version, enabled: !!keepEnabled, pending: !keepEnabled });
});

// Dashboard: view the current release + approval status.
app.get('/api/agent/release', async (c) => {
  const u = await requireAdmin(c);
  if (u instanceof Response) return u;
  const rel = await loadAgentRelease(c.env.DB);
  if (!rel || !rel.version) return c.json({ version: null });
  return c.json({
    version: rel.version,
    downloadUrl: rel.download_url,
    sha256: rel.sha256,
    enabled: !!rel.enabled,
    notes: rel.notes ?? '',
    updated_at: rel.updated_at,
  });
});

// Dashboard: approve the current release for rollout, or disable it (kill switch).
app.post('/api/agent/release/enabled', async (c) => {
  const u = await requireAdmin(c);
  if (u instanceof Response) return u;
  let body: { enabled?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be valid JSON.' }, 400);
  }
  const rel = await loadAgentRelease(c.env.DB);
  if (!rel || !rel.version) return c.json({ error: 'No release has been published yet.' }, 400);
  const enabled = body.enabled ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE agent_release SET enabled = ?1, updated_at = ?2 WHERE id = 1'
  )
    .bind(enabled, new Date().toISOString())
    .run();
  return c.json({ ok: true, enabled: !!enabled });
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

// Scheduled (cron) sweep: detect devices that have crossed into "offline" and
// fire the offline alert on that transition. Recovery is handled when a report
// arrives. Runs every few minutes (see wrangler.toml [triggers]).
async function sweepOffline(env: Env): Promise<void> {
  const cfg = await loadAlertConfig(env.DB);
  if (!cfg.on_offline) return;
  const stale = staleMinutes(env);
  const now = Date.now();
  const { results } = await env.DB.prepare(
    'SELECT id, name, client_name, last_seen_at FROM servers'
  ).all<{ id: string; name: string; client_name: string; last_seen_at: string | null }>();
  for (const s of results ?? []) {
    const status = computeStatus(s.last_seen_at, stale, now);
    await evaluateAlert(env.DB, cfg, {
      serverId: s.id,
      serverName: s.name,
      clientName: s.client_name,
      kind: 'offline',
      bad: status === 'offline',
    });
  }
}

export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    await ensureSchema(env.DB);
    ctx.waitUntil(sweepOffline(env));
  },
} satisfies ExportedHandler<Env>;
