// `check` command: run the weekly checks once and print the findings. With
// --send, also POST the run to the API. Used for diagnostics and by the service
// scheduler (which calls runAllChecks directly).

const { loadConfig } = require('../config');
const { runAllChecks } = require('../checks');
const { postCheckRun } = require('../report');
const log = require('../logger');

async function check({ send = false } = {}) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log.error('Config error:', err.message);
    process.exit(1);
    return;
  }

  log.info('Running weekly checks...');
  const results = await runAllChecks(cfg);

  // Print a compact table.
  for (const r of results) {
    const tag = r.status.toUpperCase().padEnd(4);
    console.log(`[${tag}] ${r.title}: ${r.detail}`);
  }
  const fail = results.filter((r) => r.status === 'fail').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const pass = results.filter((r) => r.status === 'pass').length;
  const overall = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';
  console.log(`\nOverall: ${overall} (${pass} pass, ${warn} warn, ${fail} fail)`);

  if (send) {
    try {
      const res = await postCheckRun(cfg, results);
      log.info('Check run sent OK:', res);
    } catch (err) {
      log.error('Send failed:', err.message);
      process.exit(1);
    }
  } else {
    log.info('Dry run (not sent). Pass --send to POST this check run.');
  }
}

module.exports = { check };
