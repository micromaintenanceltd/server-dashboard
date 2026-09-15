// Check: is a reboot pending? Looks at the usual Windows indicators. A pending
// reboot is a warning, not a failure.

const { runPsJson } = require('../lib/powershell');

module.exports = {
  id: 'pending-reboot',
  title: 'Pending reboot',
  configKey: 'pendingReboot',
  defaultEnabled: true,

  async run() {
    const script = [
      '$reasons = @()',
      "if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') { $reasons += 'Component servicing' }",
      "if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { $reasons += 'Windows Update' }",
      "$pfro = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations",
      "if ($pfro) { $reasons += 'Pending file rename' }",
      '[PSCustomObject]@{ pending = ($reasons.Count -gt 0); reasons = $reasons } | ConvertTo-Json -Compress',
    ].join('; ');

    const r = await runPsJson(script, { fallback: null });
    if (!r) {
      return { status: 'warn', detail: 'Could not determine reboot state.', value: null };
    }
    if (r.pending) {
      const reasons = Array.isArray(r.reasons) ? r.reasons.join(', ') : String(r.reasons);
      return { status: 'warn', detail: `Reboot pending (${reasons}).`, value: r };
    }
    return { status: 'pass', detail: 'No reboot pending.', value: r };
  },
};
