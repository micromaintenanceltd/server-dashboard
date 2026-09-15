// Check: antivirus (Bitdefender) present and healthy. Built from the AV
// collector data (passed in via `shared.av`).
//   fail if not installed or not running
//   warn if last scan older than scanStaleDays (when a scan date is known)

module.exports = {
  id: 'antivirus',
  title: 'Antivirus',
  configKey: 'antivirus',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const staleDays = num(checkCfg.scanStaleDays, 7);
    const av = shared.av || {};
    const product = av.product || 'Antivirus';

    if (!av.installed) {
      return { status: 'fail', detail: `${product} not detected on this server.`, value: av };
    }
    if (!av.running) {
      return { status: 'fail', detail: `${product} installed but not running.`, value: av };
    }

    if (av.last_scan) {
      const ageDays = (Date.now() - new Date(av.last_scan).getTime()) / 86400000;
      if (!isNaN(ageDays) && ageDays > staleDays) {
        return {
          status: 'warn',
          detail: `${product} running, but last scan ${Math.round(ageDays)} days ago (>${staleDays}).`,
          value: av,
        };
      }
    }

    return { status: 'pass', detail: `${product} installed and running.`, value: av };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
