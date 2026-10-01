// Alert configuration, delivery (Microsoft Teams webhook + email) and a small
// state machine that fires on transition into a bad state and again on
// recovery, so we never spam the same condition every cycle.

export interface AlertConfig {
  teams_webhook_url: string | null;
  email_to: string | null;
  email_from: string | null;
  email_api_key: string | null;
  on_check_fail: boolean;
  on_offline: boolean;
  on_crit_stopped: boolean;
}

const DEFAULTS: AlertConfig = {
  teams_webhook_url: null,
  email_to: null,
  email_from: null,
  email_api_key: null,
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
    on_check_fail: row.on_check_fail !== 0,
    on_offline: row.on_offline !== 0,
    on_crit_stopped: row.on_crit_stopped !== 0,
  };
}

function emailReady(cfg: AlertConfig): boolean {
  return !!(cfg.email_to && cfg.email_from && cfg.email_api_key);
}

// Deliver a message to every configured channel. Never throws; returns which
// channels were attempted and any errors (for the "send test" button).
export async function deliver(
  cfg: AlertConfig,
  msg: AlertMessage
): Promise<{ teams: boolean | null; email: boolean | null; errors: string[] }> {
  const errors: string[] = [];
  let teams: boolean | null = null;
  let email: boolean | null = null;

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
  return { teams, email, errors };
}

function themeColor(s: Severity): string {
  return s === 'critical' ? 'dc2626' : '16a34a';
}

async function sendTeams(webhookUrl: string, msg: AlertMessage): Promise<void> {
  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: themeColor(msg.severity),
    summary: msg.title,
    title: msg.title,
    text: msg.lines.join('\n\n'),
  };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(card),
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
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.email_api_key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: cfg.email_from, to, subject: msg.title, html }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

function esc(s: string): string {
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
    .prepare('SELECT active FROM alert_state WHERE server_id = ?1 AND kind = ?2')
    .bind(opts.serverId, opts.kind)
    .first<{ active: number }>();
  const wasActive = !!(row && row.active);

  if (opts.bad === wasActive) return; // no change

  const msg = buildMessage(opts.kind, opts.bad, {
    serverName: opts.serverName,
    clientName: opts.clientName,
    detail: opts.detail,
  });
  await deliver(cfg, msg);
  await db
    .prepare(
      `INSERT INTO alert_state (server_id, kind, active, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(server_id, kind) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`
    )
    .bind(opts.serverId, opts.kind, opts.bad ? 1 : 0, new Date().toISOString())
    .run();
}
