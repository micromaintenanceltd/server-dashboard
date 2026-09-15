// Check: disk free space on every fixed volume.
//   fail if any volume at/under failFreePercent
//   warn if any volume at/under warnFreePercent
// Reuses the disk collector's data (passed in via `shared`).

module.exports = {
  id: 'disk-space',
  title: 'Disk space',
  configKey: 'diskSpace',
  defaultEnabled: true,

  async run(cfg, shared, checkCfg) {
    const warnAt = num(checkCfg.warnFreePercent, 15);
    const failAt = num(checkCfg.failFreePercent, 7);
    const disks = shared.disks || [];

    if (disks.length === 0) {
      return { status: 'warn', detail: 'No fixed disks reported.', value: [] };
    }

    let status = 'pass';
    const problems = [];
    for (const d of disks) {
      if (d.free_percent <= failAt) {
        status = 'fail';
        problems.push(`${d.mount} ${d.free_percent}% free`);
      } else if (d.free_percent <= warnAt) {
        if (status !== 'fail') status = 'warn';
        problems.push(`${d.mount} ${d.free_percent}% free`);
      }
    }

    const summary = disks.map((d) => `${d.mount} ${d.free_percent}%`).join(', ');
    const detail =
      status === 'pass'
        ? `All volumes above ${warnAt}% free (${summary}).`
        : `Low space: ${problems.join(', ')} (warn <=${warnAt}%, fail <=${failAt}%).`;

    return { status, detail, value: disks };
  },
};

function num(v, d) {
  return typeof v === 'number' && !isNaN(v) ? v : d;
}
