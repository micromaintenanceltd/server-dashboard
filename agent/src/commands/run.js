// `run` command: the main service process. Runs three things:
//   1. Live telemetry loop (report every intervalMinutes).
//   2. Weekly check scheduler (Monday 07:00 UK by default, catch-up style).
//   3. Local settings web server on 127.0.0.1 (loopback only).
//
// Outbound HTTPS only for reporting. Never throws out of the loops: a failed
// cycle is logged and retried.

const { loadConfig, writeConfig } = require('../config');
const { collectReport, postReport, postCheckRun } = require('../report');
const { runAllChecks } = require('../checks');
const { isCheckDue } = require('../lib/schedule');
const { readState, writeState } = require('../lib/state');
const { startSettingsServer } = require('../settings/server');
const log = require('../logger');

// How often the service re-evaluates whether the weekly check slot is due.
const CHECK_POLL_MS = 5 * 60_000;

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

// Weekly check scheduler. Catch-up style: if the slot has passed and we have not
// run for it, run now. A failure leaves the slot un-recorded so it retries.
let checkRunning = false;

async function maybeRunChecks(cfg) {
  if (checkRunning) return;
  const schedule = (cfg.checks && cfg.checks.schedule) || { dayOfWeek: 'monday', hour: 7, minute: 0 };
  const state = readState();
  const { due, slotKey } = isCheckDue(new Date(), schedule, state.lastCheckWeek);
  if (!due) return;

  checkRunning = true;
  log.info(`Weekly check due for ${slotKey}, running...`);
  try {
    const results = await runAllChecks(cfg);
    await postCheckRun(cfg, results);
    state.lastCheckWeek = slotKey;
    writeState(state);
    const fail = results.filter((r) => r.status === 'fail').length;
    const warn = results.filter((r) => r.status === 'warn').length;
    log.info(`Weekly check sent for ${slotKey}: ${results.length} checks, ${fail} fail, ${warn} warn.`);
  } catch (err) {
    log.error('Weekly check failed (will retry):', err.message);
  } finally {
    checkRunning = false;
  }
}

function scheduleLine(cfg) {
  const s = (cfg.checks && cfg.checks.schedule) || { dayOfWeek: 'monday', hour: 7, minute: 0 };
  return `${s.dayOfWeek} ${String(s.hour).padStart(2, '0')}:${String(s.minute || 0).padStart(2, '0')} UK`;
}

function run() {
  let live;
  try {
    live = loadConfig();
  } catch (err) {
    log.error('Startup failed:', err.message);
    process.exit(1);
    return;
  }

  log.info(
    `MML agent starting. api=${live.apiUrl} interval=${live.intervalMinutes}min ` +
      `watching=${live.watchServices.length} services. Weekly checks: ${scheduleLine(live)} ` +
      `(config: ${live._configPath})`
  );

  let running = true;
  let currentInterval = live.intervalMinutes;

  // 1. Live telemetry loop.
  runOnceCycle(live);
  let telemetryTimer = setInterval(() => {
    if (running) runOnceCycle(live);
  }, currentInterval * 60_000);

  // 2. Weekly check scheduler loop.
  setTimeout(() => maybeRunChecks(live), 15_000);
  const checkTimer = setInterval(() => {
    if (running) maybeRunChecks(live);
  }, CHECK_POLL_MS);

  // Apply a new config from the settings page: validate, persist, swap into the
  // live object (same reference, so both loops see it), and restart the
  // telemetry timer if the interval changed.
  function applyConfig(incoming) {
    if (!incoming || typeof incoming !== 'object') throw new Error('No config provided.');
    if (!incoming.apiUrl || String(incoming.apiUrl).trim() === '') throw new Error('API URL is required.');
    if (!incoming.apiKey || String(incoming.apiKey).trim() === '') throw new Error('API key is required.');

    // Build a clean object to persist (drop internal/injected fields).
    const clean = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (k.startsWith('_')) continue;
      clean[k] = v;
    }

    // Persist to the same file the agent loaded, then reload to normalise.
    writeConfig(clean, live._configPath);
    const reloaded = loadConfig();

    // Swap contents in place so existing closures keep working.
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, reloaded);

    // Restart telemetry timer if the interval changed.
    if (live.intervalMinutes !== currentInterval) {
      currentInterval = live.intervalMinutes;
      clearInterval(telemetryTimer);
      telemetryTimer = setInterval(() => {
        if (running) runOnceCycle(live);
      }, currentInterval * 60_000);
      log.info(`Report interval changed to ${currentInterval} min.`);
    }
    log.info('Settings updated from local settings page.');
  }

  // 3. Local settings web server (loopback only).
  const settingsServer = startSettingsServer({
    getConfig: () => live,
    applyConfig,
    log,
  });

  const shutdown = (signal) => {
    log.info(`Received ${signal}, shutting down.`);
    running = false;
    clearInterval(telemetryTimer);
    clearInterval(checkTimer);
    if (settingsServer) settingsServer.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { run };
