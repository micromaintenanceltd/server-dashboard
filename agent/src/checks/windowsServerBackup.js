// Check: latest Windows Server Backup result.
//
// Mirrors the weekly-check script: read the Microsoft-Windows-Backup event log
// first (IDs 1/2 = in progress, 4 = success, 5 = failed), falling back to
// Get-WBSummary. Always reports (a server should have *some* backup), so a
// missing/failed/stale backup is visible.
//   fail : last backup failed
//   warn : no history, not available, or last success older than maxAgeHours
//   pass : recent success (or currently running)

const { runPsJson } = require('../lib/powershell');

module.exports = {
  id: 'windows-server-backup',
  title: 'Windows Server Backup',
  configKey: 'windowsServerBackup',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const maxAgeHours = num(checkCfg.maxAgeHours, 48);

    const script = [
      "$out = [ordered]@{ available=$false; result='Unknown'; lastRun=$null; message='' }",
      'try {',
      "  $e = Get-WinEvent -LogName 'Microsoft-Windows-Backup' -MaxEvents 50 -ErrorAction Stop | Where-Object { $_.Id -in 1,2,4,5 } | Sort-Object TimeCreated -Descending | Select-Object -First 1",
      '  if ($e) {',
      '    $out.available = $true',
      "    $out.lastRun = $e.TimeCreated.ToUniversalTime().ToString('o')",
      "    if ($e.Id -in 1,2) { $out.result='InProgress' }",
      "    elseif ($e.Id -eq 4) { $out.result='Success' }",
      "    else { $out.result='Failed'; $out.message = ($e.Message -replace '\\s+',' ').Trim() }",
      '  }',
      '} catch {}',
      'if (-not $out.available) {',
      '  try {',
      '    Import-Module WindowsServerBackup -ErrorAction Stop | Out-Null',
      '    $s = Get-WBSummary -ErrorAction Stop',
      '    $out.available = $true',
      '    if ($s.LastBackupTime) {',
      "      $out.lastRun = $s.LastBackupTime.ToUniversalTime().ToString('o')",
      "      if ([int]$s.LastBackupResultHR -eq 0) { $out.result='Success' } else { $out.result='Failed'; $out.message = 'HRESULT ' + $s.LastBackupResultHR }",
      "    } else { $out.result='NoHistory' }",
      '  } catch {}',
      '}',
      '[PSCustomObject]$out | ConvertTo-Json -Compress',
    ].join('; ');

    const r = await runPsJson(script, { fallback: null, timeoutMs: 40000 });
    if (!r || !r.available) {
      return { status: 'warn', detail: 'Windows Server Backup not available on this server.', value: r };
    }

    if (r.result === 'Failed') {
      return { status: 'fail', detail: `Last backup FAILED${r.message ? ': ' + trim(r.message) : ''}.`, value: r };
    }
    if (r.result === 'InProgress') {
      return { status: 'pass', detail: 'Backup currently running.', value: r };
    }
    if (r.result === 'NoHistory') {
      return { status: 'warn', detail: 'No backup history recorded.', value: r };
    }
    // Success
    const ageH = r.lastRun ? (Date.now() - Date.parse(r.lastRun)) / 3600000 : null;
    if (ageH != null && ageH > maxAgeHours) {
      return { status: 'warn', detail: `Last success ${Math.round(ageH)}h ago (older than ${maxAgeHours}h).`, value: r };
    }
    return { status: 'pass', detail: `Last backup succeeded ${ageH != null ? Math.round(ageH) + 'h ago' : ''}.`.trim(), value: r };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
function trim(s) {
  s = String(s);
  return s.length > 200 ? s.slice(0, 200) + '...' : s;
}
