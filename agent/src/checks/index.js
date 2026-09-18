// Runs the configured weekly checks and returns an array of findings:
//   [{ id, title, status: 'pass'|'warn'|'fail', detail, value }]
//
// These are MML's six production backup/health checks. Client-specific checks
// (Sage, RDPGuard, IRIS/INVU, Sage SQL, StorageCraft) return null to skip
// themselves when the relevant application is not installed/configured on the
// server, so a given server only reports the checks that apply to it.

const windowsServerBackup = require('./windowsServerBackup');
const sage = require('./sage');
const rdpguard = require('./rdpguard');
const irisInvu = require('./irisInvu');
const sageSql = require('./sageSql');
const storagecraft = require('./storagecraft');

// Display order.
const REGISTRY = [
  windowsServerBackup,
  sage,
  rdpguard,
  irisInvu,
  sageSql,
  storagecraft,
];

// A check is enabled unless its config object sets enabled:false (the tickbox
// on the local settings page). A check with no config entry defaults to on.
function isEnabled(mod, checkCfg) {
  if (checkCfg && typeof checkCfg === 'object' && !Array.isArray(checkCfg) && checkCfg.enabled === false) {
    return false;
  }
  return mod.defaultEnabled !== false;
}

async function runAllChecks(cfg) {
  const shared = {};

  const checksCfg = cfg.checks || {};
  const results = [];

  for (const mod of REGISTRY) {
    const checkCfg = checksCfg[mod.configKey];
    if (!isEnabled(mod, checkCfg)) continue;

    try {
      const res = await mod.run(cfg, shared, checkCfg || {});
      // A null result means the check does not apply to this server (e.g. the
      // application is not installed) — skip it silently.
      if (res == null) continue;
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
