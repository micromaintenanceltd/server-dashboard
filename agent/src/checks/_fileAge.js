// Shared helper: find the most recent file matching a filter in a folder, and
// report its age. Used by the IRIS/INVU and Sage SQL checks.

const { runPsJson } = require('../lib/powershell');

function psq(s) {
  return String(s).replace(/'/g, "''"); // escape single quotes for PowerShell
}

// Returns { name, mtime (ISO), ageHours } for the newest matching file, or null.
async function latestFile(path, filter) {
  const script =
    `Get-ChildItem -Path '${psq(path)}' -Filter '${psq(filter)}' -File -ErrorAction SilentlyContinue | ` +
    'Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ' +
    "ForEach-Object { [PSCustomObject]@{ name=$_.Name; mtime=$_.LastWriteTimeUtc.ToString('o') } } | " +
    'ConvertTo-Json -Compress';
  const r = await runPsJson(script, { fallback: null, timeoutMs: 20000 });
  if (!r || !r.name) return null;
  const ageHours = r.mtime ? (Date.now() - Date.parse(r.mtime)) / 3600000 : null;
  return { name: r.name, mtime: r.mtime, ageHours };
}

function ageStr(hours) {
  if (hours == null || isNaN(hours)) return 'unknown age';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function pathExists(path) {
  const r = await runPsJson(
    `[PSCustomObject]@{ ok = (Test-Path -Path '${psq(path)}') } | ConvertTo-Json -Compress`,
    { fallback: null }
  );
  return !!(r && r.ok);
}

module.exports = { latestFile, ageStr, pathExists, psq };
