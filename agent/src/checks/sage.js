// Check: Sage 50 Accounts file backups. Client-specific: skipped unless the
// Sage 50 Accounts service is present. Discovers backup folders from the
// registry, common locations, and a shallow drive scan, then finds the newest
// .001/.sbk/.zip.
//   fail : service present but no backup files found anywhere
//   warn : latest backup older than staleHours
//   pass : recent backup found

const { runPsJson } = require('../lib/powershell');
const { ageStr } = require('./_fileAge');

module.exports = {
  id: 'sage',
  title: 'Sage (file backup)',
  configKey: 'sage',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const staleHours = num(checkCfg.staleHours, 48);

    const script = [
      "$svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -imatch 'Sage 50 Accounts' } | Select-Object -First 1",
      'if (-not $svc) { [PSCustomObject]@{ installed = $false } | ConvertTo-Json -Compress }',
      'else {',
      '  $found = New-Object System.Collections.Generic.List[string]',
      "  foreach ($root in @('HKLM:\\SOFTWARE\\Sage','HKLM:\\SOFTWARE\\WOW6432Node\\Sage')) {",
      '    if (Test-Path $root) {',
      '      Get-ChildItem $root -Recurse -ErrorAction SilentlyContinue | ForEach-Object {',
      '        $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue',
      '        if ($p) { foreach ($pr in $p.PSObject.Properties) { if ($pr.Value -is [string]) { $d = $pr.Value.TrimEnd(\'\\\'); if ($d -and (Test-Path $d -PathType Container -ErrorAction SilentlyContinue)) { $found.Add($d) } } } }',
      '      }',
      '    }',
      '  }',
      "  foreach ($c in @('C:\\SageBackups','D:\\SageBackups','C:\\Sage\\Backups','D:\\Sage\\Backups','C:\\Sage\\Sage 50 Accounts\\Backups','C:\\ProgramData\\Sage\\Backups','C:\\Users\\Public\\Documents\\Sage\\Backups')) { if (Test-Path $c) { $found.Add($c) } }",
      "  Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Root -match '^[A-Za-z]:' } | ForEach-Object { try { Get-ChildItem -Path $_.Root -Depth 4 -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -imatch 'sage.{0,20}backup|backup.{0,20}sage' } | ForEach-Object { $found.Add($_.FullName) } } catch {} }",
      '  $uniq = $found | Select-Object -Unique',
      "  $files = foreach ($loc in $uniq) { Get-ChildItem -Path $loc -Recurse -Include '*.001','*.sbk','*.zip' -File -ErrorAction SilentlyContinue }",
      '  if (-not $files) { [PSCustomObject]@{ installed=$true; backupFound=$false; searched=(@($uniq) -join \'; \') } | ConvertTo-Json -Compress }',
      "  else { $l = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1; [PSCustomObject]@{ installed=$true; backupFound=$true; latestFile=$l.Name; latestTime=$l.LastWriteTimeUtc.ToString('o') } | ConvertTo-Json -Compress }",
      '}',
    ].join('\n');

    const r = await runPsJson(script, { fallback: null, timeoutMs: 90000 });
    if (!r || !r.installed) return null; // not installed -> skip

    if (!r.backupFound) {
      return {
        status: 'fail',
        detail: 'Sage installed but no backup files (.001/.sbk/.zip) found.',
        value: { searched: r.searched },
      };
    }
    const ageH = r.latestTime ? (Date.now() - Date.parse(r.latestTime)) / 3600000 : null;
    if (ageH != null && ageH > staleHours) {
      return { status: 'warn', detail: `Latest ${r.latestFile} is ${ageStr(ageH)} (older than ${staleHours}h).`, value: r };
    }
    return { status: 'pass', detail: `Latest ${r.latestFile} (${ageStr(ageH)}).`, value: r };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
