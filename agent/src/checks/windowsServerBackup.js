// Check: latest Windows Server Backup result.
//
// Uses the WindowsServerBackup PowerShell module (Get-WBSummary), which is the
// authoritative local source. LastBackupResultHR == 0 means the last backup
// succeeded.
//   fail if the last backup failed (non-zero result)
//   warn if the last successful backup is older than maxAgeHours
//   pass if the last backup succeeded within maxAgeHours
//   missing feature: warn by default, or fail if requireInstalled is set

const { runPsJson } = require('../lib/powershell');

module.exports = {
  id: 'windows-server-backup',
  title: 'Windows Server Backup',
  configKey: 'windowsServerBackup',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const maxAgeHours = num(checkCfg.maxAgeHours, 36);
    const requireInstalled = checkCfg.requireInstalled === true;

    const script = [
      'try {',
      '  Import-Module WindowsServerBackup -ErrorAction Stop',
      '  $s = Get-WBSummary',
      '  $obj = [ordered]@{',
      '    available = $true',
      '    lastResultHr = [int]$s.LastBackupResultHR',
      '    lastBackupTime = if ($s.LastBackupTime) { $s.LastBackupTime.ToUniversalTime().ToString("o") } else { $null }',
      '    lastSuccess = if ($s.LastSuccessfulBackupTime) { $s.LastSuccessfulBackupTime.ToUniversalTime().ToString("o") } else { $null }',
      '  }',
      '  [PSCustomObject]$obj | ConvertTo-Json -Compress',
      '} catch {',
      '  [PSCustomObject]@{ available = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress',
      '}',
    ].join('; ');

    const r = await runPsJson(script, { fallback: null, timeoutMs: 30000 });

    if (!r || r.available === false) {
      const detail = 'Windows Server Backup feature not available on this server.';
      return { status: requireInstalled ? 'fail' : 'warn', detail, value: r };
    }

    // A non-zero HRESULT means the most recent backup did not succeed.
    if (r.lastResultHr && r.lastResultHr !== 0) {
      return {
        status: 'fail',
        detail: `Last backup failed (result 0x${(r.lastResultHr >>> 0).toString(16)}).`,
        value: r,
      };
    }

    if (!r.lastSuccess) {
      return { status: 'fail', detail: 'No successful backup on record.', value: r };
    }

    const ageHours = (Date.now() - new Date(r.lastSuccess).getTime()) / 3600000;
    if (!isNaN(ageHours) && ageHours > maxAgeHours) {
      return {
        status: 'warn',
        detail: `Last successful backup ${Math.round(ageHours)}h ago (older than ${maxAgeHours}h).`,
        value: r,
      };
    }

    return {
      status: 'pass',
      detail: `Last backup succeeded ${Math.round(ageHours)}h ago.`,
      value: r,
    };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
