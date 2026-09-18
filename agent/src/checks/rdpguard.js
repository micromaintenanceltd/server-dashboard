// Check: RDPGuard service is running. Client-specific: if RDPGuard is not
// installed on this server, the check is skipped (returns null).

const { runPsJson, toArray } = require('../lib/powershell');

module.exports = {
  id: 'rdpguard',
  title: 'RDPGuard',
  configKey: 'rdpguard',
  defaultEnabled: true,

  async run() {
    const script =
      "Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -imatch 'rdpguard|portslock' -or $_.DisplayName -imatch 'rdpguard|rdp guard' } | " +
      'Select-Object -First 1 Name, DisplayName, Status | ConvertTo-Json -Compress';
    const raw = await runPsJson(script, { fallback: null });
    const svc = toArray(raw)[0];
    if (!svc || !svc.Name) return null; // not installed -> skip

    const running = svc.Status === 4 || svc.Status === 'Running';
    if (running) {
      return { status: 'pass', detail: `${svc.DisplayName || 'RDPGuard'} running.`, value: svc };
    }
    return {
      status: 'fail',
      detail: `${svc.DisplayName || 'RDPGuard'} installed but NOT running (status ${svc.Status}).`,
      value: svc,
    };
  },
};
