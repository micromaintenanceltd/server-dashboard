// Check: volume of Critical/Error events in the System and Application logs over
// the last N days. Informational: warns when noisy, fails only past an optional
// higher threshold.

const { runPsJson } = require('../lib/powershell');

module.exports = {
  id: 'event-log-errors',
  title: 'Event log errors (7 days)',
  configKey: 'eventLogErrors',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const days = num(checkCfg.days, 7);
    const warnCount = num(checkCfg.warnCount, 50);
    const failCount = num(checkCfg.failCount, 0); // 0 = never fail on volume alone

    const script = [
      `$since = (Get-Date).AddDays(-${days})`,
      '$total = 0',
      "foreach ($log in @('System','Application')) {",
      '  try {',
      '    $n = (Get-WinEvent -FilterHashtable @{ LogName = $log; Level = 1,2; StartTime = $since } -ErrorAction Stop | Measure-Object).Count',
      '    $total += $n',
      '  } catch { }',
      '}',
      '[PSCustomObject]@{ count = $total; days = ' + days + ' } | ConvertTo-Json -Compress',
    ].join('; ');

    const r = await runPsJson(script, { fallback: null, timeoutMs: 40000 });
    if (!r || typeof r.count !== 'number') {
      return { status: 'warn', detail: 'Could not read event logs.', value: null };
    }

    if (failCount > 0 && r.count >= failCount) {
      return { status: 'fail', detail: `${r.count} error/critical events in ${days} days.`, value: r };
    }
    if (r.count >= warnCount) {
      return { status: 'warn', detail: `${r.count} error/critical events in ${days} days.`, value: r };
    }
    return { status: 'pass', detail: `${r.count} error/critical events in ${days} days.`, value: r };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
