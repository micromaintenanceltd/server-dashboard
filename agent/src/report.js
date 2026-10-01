// Assembles a full report from all collectors and POSTs it to the API.

const system = require('./collectors/system');
const { disks } = require('./collectors/disk');
const { services } = require('./collectors/services');
const { avStatus } = require('./collectors/av');
const { patchStatus } = require('./collectors/patch');

const AGENT_VERSION = require('../package.json').version;

// Gather every metric. Collectors are best-effort and resolve to safe defaults
// on failure, so one flaky query does not stop a report going out.
async function collectReport(cfg) {
  const [cpu_percent, disk, svc, av, patch] = await Promise.all([
    system.cpuPercent(),
    disks(),
    services(cfg),
    avStatus(cfg),
    patchStatus(),
  ]);

  const mem = system.memory();

  return {
    cpu_percent,
    ram_used_mb: mem.ram_used_mb,
    ram_total_mb: mem.ram_total_mb,
    disk,
    uptime_seconds: system.uptimeSeconds(),
    services: svc,
    av,
    patch,
    meta: system.meta(AGENT_VERSION),
  };
}

// POST a report to the API using the per-server Bearer key.
async function postReport(cfg, report) {
  return postJson(cfg, '/api/report', report);
}

// POST a weekly check run to the API.
async function postCheckRun(cfg, results) {
  return postJson(cfg, '/api/checks', {
    results,
    agent_version: AGENT_VERSION,
    run_at: new Date().toISOString(),
  });
}

// Deregister this server from the dashboard (removes its own record). Called by
// the uninstaller. Best-effort: never throws, so it cannot block an uninstall.
async function deregister(cfg) {
  const url = cfg.apiUrl.replace(/\/+$/, '') + '/api/self';
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Shared POST helper. Outbound only. The parsed response body is returned so the
// caller can read the `decommission` flag (the one bounded action the API can
// signal); nothing else in the body is ever acted on. See INSTALL.md.
async function postJson(cfg, path, body) {
  const url = cfg.apiUrl.replace(/\/+$/, '') + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API responded ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// Ask the dashboard whether a settings password (typed on the local settings
// page) matches the server-side SETTINGS_PASSWORD secret. Returns true/false;
// never throws. Used to authorise local settings changes without storing any
// password on the agent.
async function verifySettingsPassword(cfg, password) {
  if (!password) return false;
  const url = cfg.apiUrl.replace(/\/+$/, '') + '/api/verify-settings-password';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    return !!(j && j.ok);
  } catch {
    return false;
  }
}

module.exports = {
  collectReport,
  postReport,
  postCheckRun,
  deregister,
  verifySettingsPassword,
  AGENT_VERSION,
};
