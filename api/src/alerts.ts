// Alert configuration, delivery (Microsoft Teams webhook + email) and a small
// state machine that fires on transition into a bad state and again on
// recovery, so we never spam the same condition every cycle.

export interface AlertConfig {
  teams_webhook_url: string | null;
  email_to: string | null;
  email_from: string | null;
  email_api_key: string | null;
  freshdesk_domain: string | null; // e.g. "micromaintenance" for micromaintenance.freshdesk.com
  freshdesk_api_key: string | null;
  freshdesk_email: string | null; // requester email the ticket is raised under
  freshdesk_group_id: string | null; // optional group to route tickets to
  on_check_fail: boolean;
  on_offline: boolean;
  on_crit_stopped: boolean;
}

const DEFAULTS: AlertConfig = {
  teams_webhook_url: null,
  email_to: null,
  email_from: null,
  email_api_key: null,
  freshdesk_domain: null,
  freshdesk_api_key: null,
  freshdesk_email: null,
  freshdesk_group_id: null,
  on_check_fail: true,
  on_offline: true,
  on_crit_stopped: true,
};

export type AlertKind = 'offline' | 'crit' | 'check';
export type Severity = 'critical' | 'good';
export interface AlertMessage {
  title: string;
  lines: string[];
  severity: Severity;
}

export async function loadAlertConfig(db: D1Database): Promise<AlertConfig> {
  const row = await db.prepare('SELECT * FROM alert_config WHERE id = 1').first<any>();
  if (!row) return { ...DEFAULTS };
  return {
    teams_webhook_url: row.teams_webhook_url || null,
    email_to: row.email_to || null,
    email_from: row.email_from || null,
    email_api_key: row.email_api_key || null,
    freshdesk_domain: row.freshdesk_domain || null,
    freshdesk_api_key: row.freshdesk_api_key || null,
    freshdesk_email: row.freshdesk_email || null,
    freshdesk_group_id: row.freshdesk_group_id || null,
    on_check_fail: row.on_check_fail !== 0,
    on_offline: row.on_offline !== 0,
    on_crit_stopped: row.on_crit_stopped !== 0,
  };
}

function emailReady(cfg: AlertConfig): boolean {
  return !!(cfg.email_to && cfg.email_from && cfg.email_api_key);
}

export function freshdeskReady(cfg: AlertConfig): boolean {
  return !!(cfg.freshdesk_domain && cfg.freshdesk_api_key && cfg.freshdesk_email);
}

function freshdeskAuth(cfg: AlertConfig): string {
  return 'Basic ' + btoa(`${cfg.freshdesk_api_key}:X`);
}
function freshdeskBase(cfg: AlertConfig): string {
  const d = String(cfg.freshdesk_domain).trim().replace(/^https?:\/\//, '').replace(/\.freshdesk\.com.*$/i, '');
  return `https://${d}.freshdesk.com/api/v2`;
}

// Create a Freshdesk ticket for a bad alert; returns the new ticket id.
async function freshdeskCreate(cfg: AlertConfig, msg: AlertMessage): Promise<string> {
  const body: Record<string, unknown> = {
    subject: msg.title,
    description: msg.lines.map((l) => `<div>${esc(l)}</div>`).join(''),
    email: cfg.freshdesk_email,
    type: 'Incident', // some accounts make ticket Type mandatory
    priority: 3, // high
    status: 2, // open
  };
  if (cfg.freshdesk_group_id && /^\d+$/.test(cfg.freshdesk_group_id)) {
    body.group_id = Number(cfg.freshdesk_group_id);
  }
  const res = await fetch(`${freshdeskBase(cfg)}/tickets`, {
    method: 'POST',
    headers: { Authorization: freshdeskAuth(cfg), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  return String(j.id);
}

// On recovery, add a private note to the ticket and resolve it.
async function freshdeskResolve(cfg: AlertConfig, ticketId: string, msg: AlertMessage): Promise<void> {
  await fetch(`${freshdeskBase(cfg)}/tickets/${ticketId}/notes`, {
    method: 'POST',
    headers: { Authorization: freshdeskAuth(cfg), 'content-type': 'application/json' },
    body: JSON.stringify({ body: msg.lines.map((l) => `<div>${esc(l)}</div>`).join(''), private: true }),
  }).catch(() => {});
  const res = await fetch(`${freshdeskBase(cfg)}/tickets/${ticketId}`, {
    method: 'PUT',
    headers: { Authorization: freshdeskAuth(cfg), 'content-type': 'application/json' },
    body: JSON.stringify({ status: 4 }), // resolved
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Create a real, low-priority test ticket (used by the "Send test alert"
// button) so the end-to-end path is actually exercised. Returns the ticket id.
export async function freshdeskTestTicket(cfg: AlertConfig): Promise<string> {
  const body: Record<string, unknown> = {
    subject: '[TEST] MML Dashboard — alert test',
    description:
      '<div>This is a test ticket from the MML dashboard to confirm Freshdesk alerting works.</div><div>You can close or delete it.</div>',
    email: cfg.freshdesk_email,
    type: 'Incident', // some accounts make ticket Type mandatory
    priority: 1, // low
    status: 2, // open
  };
  if (cfg.freshdesk_group_id && /^\d+$/.test(cfg.freshdesk_group_id)) {
    body.group_id = Number(cfg.freshdesk_group_id);
  }
  const res = await fetch(`${freshdeskBase(cfg)}/tickets`, {
    method: 'POST',
    headers: { Authorization: freshdeskAuth(cfg), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  return String(j.id);
}

// Deliver a message to every configured channel. Never throws; returns which
// channels were attempted, any errors, and (for Freshdesk) the ticket id so the
// caller can resolve it on recovery.
//   opts.createTicket   : create a Freshdesk ticket (used on a bad transition)
//   opts.resolveTicketRef: resolve this existing ticket (used on recovery)
export async function deliver(
  cfg: AlertConfig,
  msg: AlertMessage,
  opts: { createTicket?: boolean; resolveTicketRef?: string | null } = {}
): Promise<{
  teams: boolean | null;
  email: boolean | null;
  freshdesk: boolean | null;
  freshdeskRef?: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  let teams: boolean | null = null;
  let email: boolean | null = null;
  let freshdesk: boolean | null = null;
  let freshdeskRef: string | null | undefined;

  if (cfg.teams_webhook_url) {
    try {
      await sendTeams(cfg.teams_webhook_url, msg);
      teams = true;
    } catch (e: any) {
      teams = false;
      errors.push(`Teams: ${e?.message || e}`);
    }
  }
  if (emailReady(cfg)) {
    try {
      await sendEmail(cfg, msg);
      email = true;
    } catch (e: any) {
      email = false;
      errors.push(`Email: ${e?.message || e}`);
    }
  }
  if (freshdeskReady(cfg)) {
    try {
      if (opts.createTicket) {
        freshdeskRef = await freshdeskCreate(cfg, msg);
        freshdesk = true;
      } else if (opts.resolveTicketRef) {
        await freshdeskResolve(cfg, opts.resolveTicketRef, msg);
        freshdesk = true;
      }
    } catch (e: any) {
      freshdesk = false;
      errors.push(`Freshdesk: ${e?.message || e}`);
    }
  }
  return { teams, email, freshdesk, freshdeskRef, errors };
}

// Teams delivery targets the current "Workflows" (Power Automate) incoming
// webhook, which replaced the retired Office 365 Connector. That webhook
// expects an Adaptive Card wrapped as {type:"message", attachments:[...]},
// not the old MessageCard.
async function sendTeams(webhookUrl: string, msg: AlertMessage): Promise<void> {
  const accent = msg.severity === 'critical' ? 'Attention' : 'Good';
  const body = [
    { type: 'TextBlock', text: msg.title, weight: 'Bolder', size: 'Medium', color: accent, wrap: true },
    ...msg.lines.map((l) => ({ type: 'TextBlock', text: l, wrap: true, spacing: 'Small' })),
  ];
  const payload = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
        },
      },
    ],
  };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Email via Resend (https://resend.com) — a simple HTTPS API that works from a
// Worker. The API key / from-address / recipients come from the alert config.
async function sendEmail(cfg: AlertConfig, msg: AlertMessage): Promise<void> {
  const to = (cfg.email_to || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const html =
    `<h3 style="margin:0 0 8px">${esc(msg.title)}</h3>` +
    msg.lines.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join('');
  await resendSend(cfg, to, msg.title, html);
}

// Whether an outbound (non-alert) email can be sent — needs a from-address and
// a Resend API key (recipients are supplied per message).
export function canSendEmail(cfg: AlertConfig): boolean {
  return !!(cfg.email_from && cfg.email_api_key);
}

// Low-level Resend send used for both alerts and transactional mail (e.g. user
// invites). Throws on failure.
export async function resendSend(
  cfg: AlertConfig,
  to: string[],
  subject: string,
  html: string
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.email_api_key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: cfg.email_from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Build the message for a (kind, bad/recovery) combination.
export function buildMessage(
  kind: AlertKind,
  bad: boolean,
  o: { serverName: string; clientName: string; detail?: string }
): AlertMessage {
  const who = `${o.clientName} · ${o.serverName}`;
  if (kind === 'offline') {
    return bad
      ? { severity: 'critical', title: `Device offline: ${o.serverName}`, lines: [who, 'Has stopped reporting to the dashboard.'] }
      : { severity: 'good', title: `Device back online: ${o.serverName}`, lines: [who, 'Is reporting again.'] };
  }
  if (kind === 'crit') {
    return bad
      ? {
          severity: 'critical',
          title: `Critical service stopped: ${o.serverName}`,
          lines: [who, o.detail ? `Stopped: ${o.detail}` : 'A watched critical service is stopped.'],
        }
      : { severity: 'good', title: `Critical services restored: ${o.serverName}`, lines: [who, 'Watched critical services are running again.'] };
  }
  // check
  return bad
    ? {
        severity: 'critical',
        title: `Weekly check failed: ${o.serverName}`,
        lines: [who, o.detail ? `Failed: ${o.detail}` : 'One or more weekly checks failed.'],
      }
    : { severity: 'good', title: `Weekly check passed: ${o.serverName}`, lines: [who, 'All weekly checks are passing again.'] };
}

// Transition-aware evaluation. Fires an alert only when the condition flips
// (good->bad or bad->good), using the alert_state table for memory.
export async function evaluateAlert(
  db: D1Database,
  cfg: AlertConfig,
  opts: {
    serverId: string;
    serverName: string;
    clientName: string;
    kind: AlertKind;
    bad: boolean;
    detail?: string;
  }
): Promise<void> {
  const enabled =
    opts.kind === 'offline'
      ? cfg.on_offline
      : opts.kind === 'crit'
        ? cfg.on_crit_stopped
        : cfg.on_check_fail;
  if (!enabled) return;

  const row = await db
    .prepare('SELECT active, ref FROM alert_state WHERE server_id = ?1 AND kind = ?2')
    .bind(opts.serverId, opts.kind)
    .first<{ active: number; ref: string | null }>();
  const wasActive = !!(row && row.active);

  if (opts.bad === wasActive) return; // no change

  const msg = buildMessage(opts.kind, opts.bad, {
    serverName: opts.serverName,
    clientName: opts.clientName,
    detail: opts.detail,
  });
  const res = await deliver(
    cfg,
    msg,
    opts.bad ? { createTicket: true } : { resolveTicketRef: row?.ref ?? null }
  );
  // Keep the Freshdesk ticket id while active so we can resolve it on recovery.
  const ref = opts.bad ? res.freshdeskRef ?? null : null;
  await db
    .prepare(
      `INSERT INTO alert_state (server_id, kind, active, ref, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(server_id, kind) DO UPDATE SET active = excluded.active, ref = excluded.ref, updated_at = excluded.updated_at`
    )
    .bind(opts.serverId, opts.kind, opts.bad ? 1 : 0, ref, new Date().toISOString())
    .run();
}
