// Check: StorageCraft ShadowProtect SPX backup jobs. Client-specific: skipped
// unless SPX is installed. Parses the SPX log tails for each job's latest
// result and time (same approach as the weekly-check script).
//   fail : any job's last backup failed
//   warn : installed but no jobs found, or newest job older than staleHours
//   pass : recent successful jobs

const { runPsJson } = require('../lib/powershell');
const { ageStr } = require('./_fileAge');

module.exports = {
  id: 'storagecraft',
  title: 'StorageCraft ShadowProtect SPX',
  configKey: 'storagecraft',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const staleHours = num(checkCfg.staleHours, 48);

    const script = [
      "$svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -imatch 'SPXService|ShadowProtect' -or $_.DisplayName -imatch 'StorageCraft|ShadowProtect' } | Select-Object -First 1",
      "$exe = Test-Path 'C:\\Program Files\\StorageCraft\\spx\\spx_service.exe'",
      'if (-not $svc -and -not $exe) { [PSCustomObject]@{ installed = $false } | ConvertTo-Json -Compress }',
      'else {',
      "  $logDir = @('C:\\ProgramData\\StorageCraft\\spx\\log','C:\\ProgramData\\StorageCraft\\ShadowProtect\\log') | Where-Object { Test-Path $_ } | Select-Object -First 1",
      '  if (-not $logDir) { [PSCustomObject]@{ installed=$true; jobs=@() } | ConvertTo-Json -Compress }',
      '  else {',
      '    $jobs = New-Object System.Collections.Generic.List[object]',
      "    foreach ($lf in (Get-ChildItem $logDir -Filter '*.log' -ErrorAction SilentlyContinue)) {",
      '      try {',
      '        $tail = Get-Content $lf.FullName -Tail 300 -ErrorAction Stop',
      "        if (-not ($tail | Where-Object { $_ -match 'backup start|backup stop|backup success|backup failure' })) { continue }",
      "        $jn = $tail | Where-Object { $_ -match 'BackupJob\\(name=' } | Select-Object -Last 1",
      "        $name = if ($jn -match \"BackupJob\\(name=u?'([^']+)'\") { $Matches[1] } else { $lf.BaseName }",
      "        $rl = $tail | Where-Object { $_ -match 'backup success|backup failure' } | Select-Object -Last 1",
      "        $res = if ($rl -match 'backup success') { 'Success' } elseif ($rl -match 'backup failure') { 'Failed' } else { 'Unknown' }",
      "        $el = $tail | Where-Object { $_ -match 'job event created:' } | Select-Object -Last 1",
      "        $lr = if ($el -match '(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})') { [DateTime]::ParseExact($Matches[1],'yyyy-MM-dd HH:mm:ss',$null) } else { $lf.LastWriteTime }",
      "        $jobs.Add([PSCustomObject]@{ name=$name; result=$res; lastRun=$lr.ToUniversalTime().ToString('o') })",
      '      } catch { continue }',
      '    }',
      '    [PSCustomObject]@{ installed=$true; jobs=@($jobs) } | ConvertTo-Json -Compress -Depth 5',
      '  }',
      '}',
    ].join('\n');

    const r = await runPsJson(script, { fallback: null, timeoutMs: 60000 });
    if (!r || !r.installed) return null; // not installed -> skip

    const jobs = Array.isArray(r.jobs) ? r.jobs : r.jobs ? [r.jobs] : [];
    if (jobs.length === 0) {
      return { status: 'warn', detail: 'ShadowProtect installed but no backup jobs found in logs.', value: r };
    }

    const failed = jobs.filter((j) => j.result === 'Failed').map((j) => j.name);
    if (failed.length) {
      return { status: 'fail', detail: `Failed job(s): ${failed.join(', ')}.`, value: jobs };
    }

    // Staleness on the most recent job.
    const withAge = jobs.map((j) => ({
      ...j,
      ageH: j.lastRun ? (Date.now() - Date.parse(j.lastRun)) / 3600000 : null,
    }));
    const newest = withAge.filter((j) => j.ageH != null).sort((a, b) => a.ageH - b.ageH)[0];
    if (newest && newest.ageH > staleHours) {
      return { status: 'warn', detail: `Newest job (${newest.name}) ${ageStr(newest.ageH)} (older than ${staleHours}h).`, value: withAge };
    }
    return { status: 'pass', detail: `${jobs.length} job(s), latest ${newest ? ageStr(newest.ageH) : 'ok'}.`, value: withAge };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
