// Watched-service status and a light top-process summary.
//
// The watchlist comes from config (watchServices). For each entry we report
// whether the Windows service is running; any critical service that is not
// running is collected into stopped_critical for easy alerting.

const { runPsJson, toArray } = require('../lib/powershell');

async function services(cfg) {
  const watched = await watchedServices(cfg.watchServices || []);
  const stopped_critical = watched
    .filter((s) => s.critical && !s.running)
    .map((s) => s.name);

  const top_processes =
    cfg.topProcessCount > 0 ? await topProcesses(cfg.topProcessCount) : [];

  return { watched, stopped_critical, top_processes };
}

async function watchedServices(list) {
  if (list.length === 0) return [];

  // Query only the named services. Get-Service errors on unknown names, so we
  // ask per name with -ErrorAction SilentlyContinue and merge the results.
  const names = list.map((s) => `'${escapeSingle(s.name)}'`).join(',');
  const script =
    `Get-Service -Name ${names} -ErrorAction SilentlyContinue | ` +
    'Select-Object Name, Status | ConvertTo-Json -Compress';

  const raw = await runPsJson(script, { fallback: [] });
  const found = new Map();
  for (const svc of toArray(raw)) {
    if (svc && svc.Name) found.set(svc.Name.toLowerCase(), svc.Status);
  }

  return list.map((entry) => {
    // Status 4 = Running (PowerShell may serialise the enum as a number or string).
    const status = found.get(entry.name.toLowerCase());
    const running = status === 4 || status === 'Running';
    return {
      name: entry.name,
      display_name: entry.displayName || entry.name,
      running: Boolean(running),
      critical: Boolean(entry.critical),
    };
  });
}

async function topProcesses(count) {
  const script =
    `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${count} ` +
    'Name, @{N="mem_mb";E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress';

  const raw = await runPsJson(script, { fallback: [] });
  return toArray(raw)
    .filter((p) => p && p.Name)
    .map((p) => ({ name: p.Name, mem_mb: p.mem_mb }));
}

function escapeSingle(s) {
  return String(s).replace(/'/g, "''");
}

module.exports = { services };
