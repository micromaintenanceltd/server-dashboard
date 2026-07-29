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
  const url = cfg.apiUrl.replace(/\/+$/, '') + '/api/report';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(report),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API responded ${res.status}: ${text}`);
  }
  return text;
}

module.exports = { collectReport, postReport, AGENT_VERSION };
