// Check: Sage SQL backups in configured folders. Client-specific: skipped
// unless one or more paths are configured. Each path is scanned for the latest
// .bak and .zip.
//   fail : a configured path has no .bak and no .zip
//   warn : latest backup older than staleHours
//   pass : recent backups present in every configured path

const { latestFile, ageStr, pathExists } = require('./_fileAge');

module.exports = {
  id: 'sage-sql',
  title: 'Sage SQL backups',
  configKey: 'sageSql',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const staleHours = num(checkCfg.staleHours, 48);
    const paths = (Array.isArray(checkCfg.paths) ? checkCfg.paths : [])
      .map((p) => String(p).trim())
      .filter(Boolean);
    if (paths.length === 0) return null; // not configured -> skip

    const missing = [];
    const stale = [];
    const oks = [];
    const value = [];

    for (const path of paths) {
      if (!(await pathExists(path))) {
        missing.push(`${path} (inaccessible)`);
        value.push({ path, accessible: false });
        continue;
      }
      const bak = await latestFile(path, '*.bak');
      const zip = await latestFile(path, '*.zip');
      value.push({ path, bak, zip });
      if (!bak && !zip) {
        missing.push(path);
        continue;
      }
      const newest = [bak, zip].filter(Boolean).sort((a, b) => a.ageHours - b.ageHours)[0];
      if (newest.ageHours > staleHours) stale.push(`${path} (${ageStr(newest.ageHours)})`);
      else oks.push(path);
    }

    if (missing.length) {
      return { status: 'fail', detail: `No backups in: ${missing.join('; ')}.`, value };
    }
    if (stale.length) {
      return { status: 'warn', detail: `Stale (older than ${staleHours}h): ${stale.join('; ')}.`, value };
    }
    return { status: 'pass', detail: `Recent backups in ${oks.length} path(s).`, value };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
