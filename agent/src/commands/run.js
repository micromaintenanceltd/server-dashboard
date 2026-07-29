// `run` command: the main reporting loop. This is what the Windows service runs.
//
// Collects a report immediately on start, then every intervalMinutes. Outbound
// HTTPS only. Never throws out of the loop: a failed cycle is logged and retried.

const { loadConfig } = require('../config');
const { collectReport, postReport } = require('../report');
const log = require('../logger');

async function runOnceCycle(cfg) {
  const started = Date.now();
  try {
    const report = await collectReport(cfg);
    await postReport(cfg, report);
    const ms = Date.now() - started;
    const stopped = report.services.stopped_critical || [];
    log.info(
      `Report sent in ${ms}ms. cpu=${report.cpu_percent}% ` +
        `ram=${report.ram_used_mb}/${report.ram_total_mb}MB ` +
        `disks=${report.disk.length} ` +
        `criticalStopped=${stopped.length ? stopped.join(',') : 'none'}`
    );
  } catch (err) {
    log.error('Report failed:', err.message);
  }
}

function run() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log.error('Startup failed:', err.message);
    process.exit(1);
    return;
  }

  log.info(
    `MML agent starting. api=${cfg.apiUrl} interval=${cfg.intervalMinutes}min ` +
      `watching=${cfg.watchServices.length} services (config: ${cfg._configPath})`
  );

  const intervalMs = cfg.intervalMinutes * 60_000;
  let running = true;

  runOnceCycle(cfg);
  const timer = setInterval(() => {
    if (running) runOnceCycle(cfg);
  }, intervalMs);

  const shutdown = (signal) => {
    log.info(`Received ${signal}, shutting down.`);
    running = false;
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { run };
