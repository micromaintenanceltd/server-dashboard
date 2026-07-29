// ServerState: one Durable Object instance per server.
//
// Purpose (per the brief): hold live per-server state so the dashboard can read
// near real-time status without hammering D1, and detect when a server goes
// quiet. Each instance keeps the latest report snapshot in DO storage and arms
// an alarm; if no new report arrives before the alarm fires, the server is
// marked stale/offline in D1.

import type { Env, ReportPayload } from '../types';

interface StoredSnapshot {
  serverId: string;
  report: ReportPayload;
  reportedAt: string; // ISO-8601 UTC
}

export class ServerState {
  private ctx: DurableObjectState;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Ingest a fresh report: store the snapshot and (re)arm the stale alarm.
    if (url.pathname === '/ingest' && request.method === 'POST') {
      const body = (await request.json()) as {
        serverId: string;
        report: ReportPayload;
        reportedAt: string;
        staleAfterMinutes: number;
      };

      const snapshot: StoredSnapshot = {
        serverId: body.serverId,
        report: body.report,
        reportedAt: body.reportedAt,
      };
      await this.ctx.storage.put('snapshot', snapshot);

      // Arm an alarm for staleAfterMinutes from now. A new report resets it.
      const when = Date.parse(body.reportedAt) + body.staleAfterMinutes * 60_000;
      await this.ctx.storage.setAlarm(when);

      return json({ ok: true });
    }

    // Return the live snapshot for the detail view.
    if (url.pathname === '/status' && request.method === 'GET') {
      const snapshot = await this.ctx.storage.get<StoredSnapshot>('snapshot');
      return json({ snapshot: snapshot ?? null });
    }

    return new Response('Not found', { status: 404 });
  }

  // Fired when a server has gone quiet for longer than the stale window.
  async alarm(): Promise<void> {
    const snapshot = await this.ctx.storage.get<StoredSnapshot>('snapshot');
    if (!snapshot) return;

    // Mark offline in D1 only if it has not reported since the alarm was set.
    // (A newer report would have re-armed the alarm to a later time.)
    try {
      await this.env.DB.prepare(
        `UPDATE servers SET current_status = 'offline' WHERE id = ?1`
      )
        .bind(snapshot.serverId)
        .run();
    } catch (err) {
      // Swallow: the next report will correct status regardless.
      console.error('ServerState alarm D1 update failed', err);
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
