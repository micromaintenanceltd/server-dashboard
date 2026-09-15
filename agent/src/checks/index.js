// Runs the configured weekly checks and returns an array of findings:
//   [{ id, title, status: 'pass'|'warn'|'fail', detail, value }]
//
// Shared inputs (disks, patch, AV) are gathered once from the existing
// collectors and passed to the checks that need them, so we do not run the same
// PowerShell queries twice.

const { disks } = require('../collectors/disk');
const { patchStatus } = require('../collectors/patch');
const { avStatus } = require('../collectors/av');

const windowsServerBackup = require('./windowsServerBackup');
const requiredServices = require('./requiredServices');
const diskSpace = require('./diskSpace');
const { pendingUpdates, lastUpdate } = require('./updates');
const antivirus = require('./antivirus');
const pendingReboot = require('./pendingReboot');
const firewall = require('./firewall');
const eventLogErrors = require('./eventLogErrors');

// Display order.
const REGISTRY = [
  windowsServerBackup,
  requiredServices,
  diskSpace,
  pendingUpdates,
  lastUpdate,
  antivirus,
  pendingReboot,
  firewall,
  eventLogErrors,
];

// A check is enabled unless its config object sets enabled:false. (Config that
// is an array, like requiredServices, is always considered enabled.)
function isEnabled(mod, checkCfg) {
  if (checkCfg && typeof checkCfg === 'object' && !Array.isArray(checkCfg) && checkCfg.enabled === false) {
    return false;
  }
  return mod.defaultEnabled !== false;
}

async function runAllChecks(cfg) {
  const shared = {};
  try { shared.disks = await disks(); } catch { shared.disks = []; }
  try { shared.patch = await patchStatus(); } catch { shared.patch = {}; }
  try { shared.av = await avStatus(cfg); } catch { shared.av = {}; }

  const checksCfg = cfg.checks || {};
  const results = [];

  for (const mod of REGISTRY) {
    const checkCfg = checksCfg[mod.configKey];
    if (!isEnabled(mod, checkCfg)) continue;

    try {
      const res = await mod.run(cfg, shared, checkCfg || {});
      results.push({
        id: mod.id,
        title: mod.title,
        status: res.status || 'warn',
        detail: res.detail || '',
        value: res.value ?? null,
      });
    } catch (err) {
      // A broken check should never sink the whole run.
      results.push({
        id: mod.id,
        title: mod.title,
        status: 'warn',
        detail: `Check error: ${err.message}`,
        value: null,
      });
    }
  }

  return results;
}

module.exports = { runAllChecks, REGISTRY };
