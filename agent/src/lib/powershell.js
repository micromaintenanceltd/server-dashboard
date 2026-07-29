// Runs a PowerShell command and parses its stdout as JSON.
//
// Windows-specific metrics (disks, services, updates) are cheapest to gather
// via PowerShell/CIM rather than pulling in native npm modules. Every command
// is run non-interactively with a timeout so a hung query cannot stall the
// agent loop.

const { execFile } = require('child_process');

// Run a PowerShell snippet. The snippet should emit JSON on stdout
// (e.g. `... | ConvertTo-Json`). Returns the parsed value, or `fallback`
// on any error/timeout so a single failed collector never crashes a report.
function runPsJson(script, { fallback = null, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        // Note: we parse stdout even when `err` is set. PowerShell exits with a
        // non-zero code when a non-terminating error record is emitted (e.g.
        // Get-Service on a name that does not exist, despite
        // -ErrorAction SilentlyContinue), yet still writes valid JSON to stdout.
        // Only fall back when there is nothing parseable.
        const text = (stdout || '').trim();
        if (!text) return resolve(fallback);
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve(fallback);
        }
      }
    );
  });
}

// Normalise PowerShell's ConvertTo-Json quirk: a single object is not wrapped
// in an array. Always return an array.
function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

module.exports = { runPsJson, toArray };
