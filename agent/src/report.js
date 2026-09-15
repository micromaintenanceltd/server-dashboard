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

// Shared POST helper. Outbound only; the response is used solely to detect
// failure, never acted on. See INSTALL.md on the one-directional design.
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
  return text;
}

module.exports = { collectReport, postReport, postCheckRun, AGENT_VERSION };
