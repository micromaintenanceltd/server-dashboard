// Check: RDPGuard service is running. Client-specific: if RDPGuard is not
// installed on this server, the check is skipped (returns null).

const { runPsJson, toArray } = require('../lib/powershell');

module.exports = {
  id: 'rdpguard',
  title: 'RDPGuard',
  configKey: 'rdpguard',
  defaultEnabled: false,

  async run() {
    const script =
      "Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -imatch 'rdpguard|portslock' -or $_.DisplayName -imatch 'rdpguard|rdp guard' } | " +
      'Select-Object -First 1 Name, DisplayName, Status | ConvertTo-Json -Compress';
    const raw = await runPsJson(script, { fallback: null });
    const svc = toArray(raw)[0];
    if (!svc || !svc.Name) {
      // Enabled for this device but not found. The technician chose to check it,
      // so surface it (untick the check if RDPGuard doesn't apply here).
      return { status: 'warn', detail: 'RDPGuard not detected on this device.', value: null };
    }

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
