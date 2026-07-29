// `once` command: collect a single report and print it. With --send, also POST
// it. Useful for verifying config and collectors on a new server.

const { loadConfig } = require('../config');
const { collectReport, postReport } = require('../report');
const log = require('../logger');

async function once({ send = false } = {}) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log.error('Config error:', err.message);
    process.exit(1);
    return;
  }

  log.info('Collecting one report...');
  const report = await collectReport(cfg);
  console.log(JSON.stringify(report, null, 2));

  if (send) {
    try {
      const res = await postReport(cfg, report);
      log.info('Sent OK:', res);
    } catch (err) {
      log.error('Send failed:', err.message);
      process.exit(1);
    }
  } else {
    log.info('Dry run (not sent). Pass --send to POST this report.');
  }
}

module.exports = { once };
