// Windows patch / update status via the Windows Update COM API.
//   pending_updates      : count of applicable, not-installed, non-hidden updates
//   last_update_installed: date of the most recent entry in the update history
//
// Both are wrapped in try/catch inside PowerShell so that, for example, a
// missing WSUS connection only nulls the affected field instead of failing the
// whole report. The search can touch the network, so we allow a long timeout.

const { runPsJson } = require('../lib/powershell');

async function patchStatus() {
  const script = [
    '$out = [ordered]@{ pending = $null; last = $null; list = @() }',
    'try {',
    '  $s = New-Object -ComObject Microsoft.Update.Session',
    '  $r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0")',
    '  $out.pending = [int]$r.Updates.Count',
    '  $out.list = @($r.Updates | Select-Object -First 60 | ForEach-Object {',
    '    [ordered]@{ title = $_.Title; severity = $_.MsrcSeverity; kb = (@($_.KBArticleIDs) -join ","); categories = @($_.Categories | ForEach-Object { $_.Name }) }',
    '  })',
    '} catch {}',
    'try {',
    '  $s2 = New-Object -ComObject Microsoft.Update.Session',
    '  $searcher = $s2.CreateUpdateSearcher()',
    '  $c = $searcher.GetTotalHistoryCount()',
    '  if ($c -gt 0) { $out.last = ($searcher.QueryHistory(0,1))[0].Date.ToUniversalTime().ToString("o") }',
    '} catch {}',
    '[PSCustomObject]$out | ConvertTo-Json -Compress -Depth 5',
  ].join('; ');

  const raw = await runPsJson(script, { fallback: null, timeoutMs: 60000 });

  const result = {
    last_update_installed: null,
    pending_updates: null,
    pending_list: [],
    notes: '',
  };

  if (!raw) {
    result.notes = 'Could not query Windows Update (COM API unavailable or timed out).';
    return result;
  }

  if (typeof raw.pending === 'number') result.pending_updates = raw.pending;
  if (raw.last) result.last_update_installed = raw.last;
  if (Array.isArray(raw.list)) {
    result.pending_list = raw.list
      .filter((u) => u && u.title)
      .map((u) => ({
        title: String(u.title).slice(0, 300),
        severity: u.severity ? String(u.severity) : null,
        kb: u.kb ? String(u.kb) : null,
        categories: Array.isArray(u.categories) ? u.categories.map((c) => String(c)) : [],
      }));
  }
  return result;
}

module.exports = { patchStatus };
