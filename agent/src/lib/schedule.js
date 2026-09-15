// Weekly schedule logic for the check run.
//
// All comparisons are done in UK wall-clock time (Europe/London) via Intl, so
// they are correct across GMT/BST with no manual offset maths. The scheduler is
// "catch-up" style: instead of computing the next run time and sleeping, it asks
// "has this week's slot already passed, and have we run for it yet?". If the
// machine was off at the scheduled moment, the run happens the next time the
// service is up and notices the slot is overdue.

const DAYS = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const WEEKDAY_SHORT = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Extract UK-local calendar parts from a Date.
function ukParts(now) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return {
    dow: WEEKDAY_SHORT[parts.weekday] || 1,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date (YYYY-MM-DD) of the target weekday within the current UK week (Mon-Sun).
function slotDateStr(p, targetDow) {
  // Build a date-only UTC value for calendar arithmetic (no tz effect on dates).
  const todayUtc = Date.UTC(p.year, p.month - 1, p.day);
  const mondayUtc = todayUtc - (p.dow - 1) * 86400000;
  const slotUtc = mondayUtc + (targetDow - 1) * 86400000;
  const d = new Date(slotUtc);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Returns { due, slotKey }.
//   schedule: { dayOfWeek: 'monday', hour: 7, minute: 0 }
//   lastRunKey: the slotKey we last ran for (or null/undefined)
function isCheckDue(now, schedule, lastRunKey) {
  const targetDow = DAYS[(schedule.dayOfWeek || 'monday').toLowerCase()] || 1;
  const targetHour = Number.isInteger(schedule.hour) ? schedule.hour : 7;
  const targetMin = Number.isInteger(schedule.minute) ? schedule.minute : 0;

  const p = ukParts(now);
  const slotKey = slotDateStr(p, targetDow);

  // Has this week's slot moment already passed (in UK time)?
  let passed;
  if (p.dow > targetDow) passed = true;
  else if (p.dow < targetDow) passed = false;
  else passed = p.hour > targetHour || (p.hour === targetHour && p.minute >= targetMin);

  const due = passed && lastRunKey !== slotKey;
  return { due, slotKey };
}

module.exports = { isCheckDue, ukParts, slotDateStr };
