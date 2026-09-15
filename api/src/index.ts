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
import { isIpAllowed } from './ipAllowlist';

// Re-export the Durable Object classes so the runtime can find them.
export { ServerState } from './durable/serverState';
export { EnrollLimiter } from './durable/enrollLimiter';

const app = new Hono<{ Bindings: Env }>();

// Permissive CORS: the API is protected by the IP allowlist and (for writes)
// the admin token, so we can allow the dashboard origin freely. Tighten the
// origin list here if you prefer.
app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'] }));

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

// Guard for the technician (read) routes: IP allowlist only.
function requireAllowedIp(c: any): Response | null {
  if (!isIpAllowed(c.req.raw, c.env.DASHBOARD_IP_ALLOWLIST)) {
    return c.json({ error: 'Forbidden: your IP is not on the dashboard allowlist.' }, 403);
  }
  return null;
}

// Guard for admin (write) routes: IP allowlist + admin bearer token.
function requireAdmin(c: any): Response | null {
  const ipBlock = requireAllowedIp(c);
  if (ipBlock) return ipBlock;

  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: 'Unauthorized: admin token required.' }, 401);
  }
  return null;
}

// --- Health ---------------------------------------------------------------

app.get('/', (c) => c.text('MML Server Dashboard API'));
app.get('/api/health', (c) => c.json({ ok: true, service: 'mml-dashboard-api' }));

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

  return c.json({ ok: true, received_at: reportedAt });
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
  const block = requireAllowedIp(c);
  if (block) return block;

  const staleAfter = staleMinutes(c.env);
  const now = Date.now();

  // Roster plus the latest report snapshot and the latest weekly check summary
  // (single query, LEFT JOINs onto the most recent report/check per server).
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.client_name, s.location, s.current_status,
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
  const block = requireAllowedIp(c);
  if (block) return block;

  const id = c.req.param('id');
  const staleAfter = staleMinutes(c.env);
  const now = Date.now();

  const server = await c.env.DB.prepare(
    `SELECT id, name, client_name, location, current_status,
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
  const block = requireAdmin(c);
  if (block) return block;

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

// --- DELETE /api/servers/:id : admin removes a server ---------------------
app.delete('/api/servers/:id', async (c) => {
  const block = requireAdmin(c);
  if (block) return block;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT id FROM servers WHERE id = ?1`)
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'Server not found.' }, 404);

  // ON DELETE CASCADE removes the report history too.
  await c.env.DB.prepare(`DELETE FROM servers WHERE id = ?1`).bind(id).run();
  return c.json({ ok: true, deleted: id });
});

// --- POST /api/servers/:id/rotate-key : admin revokes + reissues a key ----
app.post('/api/servers/:id/rotate-key', async (c) => {
  const block = requireAdmin(c);
  if (block) return block;

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
