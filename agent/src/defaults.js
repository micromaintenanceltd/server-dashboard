// Default agent configuration written at enrollment time. A technician can edit
// config.json afterwards to tune the watchlist for a particular server.

module.exports = {
  intervalMinutes: 5,
  avProduct: 'Bitdefender GravityZone',
  avServiceNames: ['EPProtectedService', 'EPSecurityService', 'EPUpdateService'],
  watchServices: [
    { name: 'EPSecurityService', displayName: 'Bitdefender Endpoint Security', critical: true },
    { name: 'W32Time', displayName: 'Windows Time', critical: false },
    { name: 'LanmanServer', displayName: 'Server (file sharing)', critical: false },
  ],
  topProcessCount: 5,

  // Local settings web page, served on loopback only (127.0.0.1).
  settings: { enabled: true, port: 8000 },

  // Weekly check run configuration. Runs once a week at the scheduled UK time.
  // Each check can be tuned or disabled ("enabled": false).
  checks: {
    schedule: { dayOfWeek: 'monday', hour: 7, minute: 0 },
    windowsServerBackup: { enabled: true, maxAgeHours: 36, requireInstalled: false },
    // Per-server list of services that must be running. Add the client's
    // critical services here (SQL, backup agent, line-of-business services).
    requiredServices: { list: [] },
    diskSpace: { enabled: true, warnFreePercent: 15, failFreePercent: 7 },
    pendingUpdates: { enabled: true, warnAny: true, failCount: 20 },
    lastUpdate: { enabled: true, maxDays: 45 },
    antivirus: { enabled: true, scanStaleDays: 7 },
    pendingReboot: { enabled: true },
    firewall: { enabled: true },
    eventLogErrors: { enabled: true, days: 7, warnCount: 50, failCount: 0 },
  },
};
