// Per-volume disk usage via CIM (Win32_LogicalDisk, DriveType 3 = local fixed).
// Returns an array of { mount, used_gb, total_gb, free_percent }.

const { runPsJson, toArray } = require('../lib/powershell');

async function disks() {
  const script =
    "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | " +
    'Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json -Compress';

  const raw = await runPsJson(script, { fallback: [] });
  return toArray(raw)
    .filter((d) => d && d.Size)
    .map((d) => {
      const totalGb = bytesToGb(d.Size);
      const freeGb = bytesToGb(d.FreeSpace);
      const usedGb = round(totalGb - freeGb, 1);
      const freePercent = d.Size > 0 ? round((d.FreeSpace / d.Size) * 100, 1) : 0;
      return {
        mount: d.DeviceID, // e.g. "C:"
        used_gb: usedGb,
        total_gb: round(totalGb, 1),
        free_percent: freePercent,
      };
    });
}

function bytesToGb(bytes) {
  return Number(bytes) / 1024 ** 3;
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

module.exports = { disks };
