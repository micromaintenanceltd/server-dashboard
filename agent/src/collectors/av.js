// Antivirus status, targeted at Bitdefender GravityZone.
//
// GravityZone does not expose a clean local API for "last scan", and on
// Server OS the Windows Security Center (root\SecurityCenter2) provider is not
// available. So detection is based on the Bitdefender agent services:
//   installed = any configured AV service exists
//   running   = any configured AV service is running
// last_scan is best effort: we look for the newest Bitdefender scan log and
// use its timestamp; if nothing is found we report null with a note rather
// than guessing.

const { runPsJson, toArray } = require('../lib/powershell');

async function avStatus(cfg) {
  const product = cfg.avProduct || 'Bitdefender GravityZone';
  const names = cfg.avServiceNames || [];

  const result = { product, installed: false, running: false, last_scan: null, notes: '' };

  if (names.length > 0) {
    const nameList = names.map((n) => `'${escapeSingle(n)}'`).join(',');
    const script =
      `Get-Service -Name ${nameList} -ErrorAction SilentlyContinue | ` +
      'Select-Object Name, Status | ConvertTo-Json -Compress';
    const raw = await runPsJson(script, { fallback: [] });
    const found = toArray(raw);
    result.installed = found.length > 0;
    result.running = found.some((s) => s && (s.Status === 4 || s.Status === 'Running'));
  }

  // Best-effort last scan: newest .log under the Bitdefender ProgramData tree.
  const lastScan = await bestEffortLastScan();
  if (lastScan) {
    result.last_scan = lastScan;
  } else {
    result.notes = 'Last scan date not exposed locally by the GravityZone agent.';
  }

  if (!result.installed) result.notes = 'Bitdefender agent services not detected.';

  return result;
}

async function bestEffortLastScan() {
  // Look for the most recently written Bitdefender log as a proxy for activity.
  // This is a heuristic; treat it as indicative only.
  // The final if/else emits either an ISO date string or "", which we pipe to
  // ConvertTo-Json so runPsJson can parse it as a JSON string.
  const script =
    '$paths = @("$env:ProgramData\\Bitdefender", "$env:ProgramFiles\\Bitdefender"); ' +
    '$f = Get-ChildItem -Path $paths -Recurse -Include *.log -ErrorAction SilentlyContinue | ' +
    'Sort-Object LastWriteTime -Descending | Select-Object -First 1; ' +
    '$d = if ($f) { $f.LastWriteTimeUtc.ToString("o") } else { "" }; ' +
    '$d | ConvertTo-Json -Compress';

  const raw = await runPsJson(script, { fallback: null, timeoutMs: 15000 });
  return raw && typeof raw === 'string' ? raw : null;
}

function escapeSingle(s) {
  return String(s).replace(/'/g, "''");
}

module.exports = { avStatus };
