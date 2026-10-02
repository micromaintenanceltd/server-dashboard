// Last-restart information: the boot time and the reason, read from the Windows
// System event log. The reason comes from the most recent shutdown/restart
// event:
//   1074  planned shutdown/restart (rich message: who/why/type)
//   6008  previous shutdown was unexpected
//   41    Kernel-Power: rebooted without a clean shutdown (power loss / crash)
//   6006  the event log service was stopped cleanly (clean shutdown)
//
// Reboot info only changes when the machine reboots (which restarts this agent),
// so we query once per run and cache it.

const { runPsJson } = require('../lib/powershell');

let cached = null;

async function rebootInfo() {
  if (cached) return cached;

  const script = [
    "$o=[ordered]@{boot=$null;reason=$null;id=$null;time=$null}",
    "try{$o.boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')}catch{}",
    "try{",
    "$e=Get-WinEvent -FilterHashtable @{LogName='System';Id=1074,6006,6008,41} -MaxEvents 20 -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object -First 1",
    "if($e){$o.id=[int]$e.Id;$o.time=$e.TimeCreated.ToUniversalTime().ToString('o');",
    "switch($e.Id){6008{$o.reason='Unexpected shutdown'}41{$o.reason='Unexpected restart (power loss or system crash)'}6006{$o.reason='Clean shutdown'}default{$o.reason=$e.Message}}}",
    "}catch{}",
    '[PSCustomObject]$o|ConvertTo-Json -Compress',
  ].join(';');

  const raw = await runPsJson(script, { fallback: null, timeoutMs: 20000 });

  const out = { last_boot_at: null, reason: null, event_id: null, event_time: null };
  if (raw) {
    if (raw.boot) out.last_boot_at = raw.boot;
    if (raw.reason) out.reason = String(raw.reason).replace(/\s+/g, ' ').trim().slice(0, 500);
    if (typeof raw.id === 'number') out.event_id = raw.id;
    if (raw.time) out.event_time = raw.time;
  }
  cached = out;
  return out;
}

module.exports = { rebootInfo };
