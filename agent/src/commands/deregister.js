// `deregister` command: remove this server's own record from the dashboard.
// Run by the uninstaller (Inno UninstallRun / PowerShell -Uninstall) so a
// removed agent disappears from the dashboard. Always exits cleanly so it can
// never block an uninstall.

const { loadConfig } = require('../config');
const { deregister } = require('../report');
const log = require('../logger');

async function deregisterCmd() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log.warn(`Deregister: no usable config (${err.message}); nothing to remove.`);
    return;
  }

  const r = await deregister(cfg);
  if (r.ok) {
    log.info('Deregistered from the dashboard.');
  } else {
    log.warn(
      `Deregister did not confirm (${r.status || r.error || 'unknown'}). ` +
        'Continuing; an admin can remove the record from the dashboard.'
    );
  }
}

module.exports = { deregisterCmd };
