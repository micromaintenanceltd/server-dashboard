// Check: IRIS / INVU backups. Client-specific: skipped unless the INVU V6
// Business Engine service is present. Looks in the configured backup path for
// the latest IRIS*.bak (database) and IRISDOCS*.zip (documents).
//   fail : installed but path not set/accessible, or a required backup missing
//   warn : a backup is older than staleHours
//   pass : both present and recent

const { runPsJson, toArray } = require('../lib/powershell');
const { latestFile, ageStr, pathExists } = require('./_fileAge');

module.exports = {
  id: 'iris-invu',
  title: 'IRIS / INVU',
  configKey: 'irisInvu',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const staleHours = num(checkCfg.staleHours, 48);
    const backupPath = (checkCfg.backupPath || '').trim();

    const raw = await runPsJson(
      "Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'INVU V6 Business Engine' } | Select-Object -First 1 Name | ConvertTo-Json -Compress",
      { fallback: null }
    );
    if (!toArray(raw)[0]) return null; // not installed -> skip

    if (!backupPath) {
      return { status: 'fail', detail: 'IRIS/INVU installed but no backup path configured (set it on the settings page).', value: null };
    }
    if (!(await pathExists(backupPath))) {
      return { status: 'fail', detail: `IRIS/INVU backup path not accessible: ${backupPath}`, value: { backupPath } };
    }

    const db = await latestFile(backupPath, 'IRIS*.bak');
    const docs = await latestFile(backupPath, 'IRISDOCS*.zip');

    const problems = [];
    if (!db) problems.push('no IRIS*.bak found');
    if (!docs) problems.push('no IRISDOCS*.zip found');
    if (problems.length) {
      return { status: 'fail', detail: problems.join('; ') + ` in ${backupPath}.`, value: { db, docs, backupPath } };
    }

    const stale = [];
    if (db.ageHours > staleHours) stale.push(`DB ${ageStr(db.ageHours)}`);
    if (docs.ageHours > staleHours) stale.push(`Docs ${ageStr(docs.ageHours)}`);
    if (stale.length) {
      return { status: 'warn', detail: `Backups older than ${staleHours}h: ${stale.join(', ')}.`, value: { db, docs } };
    }
    return {
      status: 'pass',
      detail: `DB ${ageStr(db.ageHours)}, Docs ${ageStr(docs.ageHours)}.`,
      value: { db, docs },
    };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
