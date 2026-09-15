// Check: required services are running.
//
// The list is per-server, from config.checks.requiredServices. Each entry is a
// service name string, or { name, displayName }. Any listed service that is not
// running makes the check fail.

const { runPsJson, toArray } = require('../lib/powershell');

module.exports = {
  id: 'required-services',
  title: 'Required services running',
  configKey: 'requiredServices',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    // Accept either an array directly, or { list: [...] } via checkCfg.
    const rawList = Array.isArray(checkCfg) ? checkCfg : checkCfg.list || checkCfg.services || [];
    const list = rawList.map((e) => (typeof e === 'string' ? { name: e } : e)).filter((e) => e && e.name);

    if (list.length === 0) {
      return {
        status: 'pass',
        detail: 'No required services configured for this server.',
        value: [],
      };
    }

    const names = list.map((s) => `'${String(s.name).replace(/'/g, "''")}'`).join(',');
    const script =
      `Get-Service -Name ${names} -ErrorAction SilentlyContinue | ` +
      'Select-Object Name, Status | ConvertTo-Json -Compress';
    const raw = await runPsJson(script, { fallback: [] });

    const found = new Map();
    for (const svc of toArray(raw)) {
      if (svc && svc.Name) found.set(svc.Name.toLowerCase(), svc.Status);
    }

    const results = list.map((entry) => {
      const status = found.get(entry.name.toLowerCase());
      const present = status !== undefined;
      const running = status === 4 || status === 'Running';
      return {
        name: entry.name,
        display_name: entry.displayName || entry.name,
        present,
        running: Boolean(running),
      };
    });

    const notRunning = results.filter((r) => !r.running);
    if (notRunning.length > 0) {
      const missing = results.filter((r) => !r.present).map((r) => r.name);
      const stopped = results.filter((r) => r.present && !r.running).map((r) => r.name);
      const bits = [];
      if (stopped.length) bits.push(`stopped: ${stopped.join(', ')}`);
      if (missing.length) bits.push(`not installed: ${missing.join(', ')}`);
      return { status: 'fail', detail: bits.join('; '), value: results };
    }

    return {
      status: 'pass',
      detail: `All ${results.length} required services running.`,
      value: results,
    };
  },
};
