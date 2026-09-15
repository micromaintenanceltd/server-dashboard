// Check: Windows Update health. Two related checks built from the patch
// collector data (passed in via `shared.patch`).
//
//   pending-updates : warn if any pending; fail if pending count >= failCount
//   last-update     : fail if no update installed within maxDays

const pendingUpdates = {
  id: 'pending-updates',
  title: 'Pending Windows updates',
  configKey: 'pendingUpdates',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const failCount = num(checkCfg.failCount, 20);
    const warnAny = checkCfg.warnAny !== false; // default true
    const pending = shared.patch ? shared.patch.pending_updates : null;

    if (pending == null) {
      return {
        status: 'warn',
        detail: 'Pending update count unavailable (Windows Update could not be queried).',
        value: null,
      };
    }
    if (pending >= failCount) {
      return { status: 'fail', detail: `${pending} pending updates (fail at >=${failCount}).`, value: pending };
    }
    if (pending > 0 && warnAny) {
      return { status: 'warn', detail: `${pending} pending updates.`, value: pending };
    }
    return { status: 'pass', detail: 'No pending updates.', value: pending };
  },
};

const lastUpdate = {
  id: 'last-update',
  title: 'Last update installed',
  configKey: 'lastUpdate',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const maxDays = num(checkCfg.maxDays, 45);
    const last = shared.patch ? shared.patch.last_update_installed : null;

    if (!last) {
      return { status: 'warn', detail: 'Last update date unavailable.', value: null };
    }
    const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
    if (isNaN(ageDays)) {
      return { status: 'warn', detail: 'Last update date unreadable.', value: last };
    }
    if (ageDays > maxDays) {
      return {
        status: 'fail',
        detail: `Last update ${Math.round(ageDays)} days ago (fail at >${maxDays}).`,
        value: last,
      };
    }
    return { status: 'pass', detail: `Last update ${Math.round(ageDays)} days ago.`, value: last };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}

module.exports = { pendingUpdates, lastUpdate };
