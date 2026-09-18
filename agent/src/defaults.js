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
  // Each check can be ticked on/off in the local settings page ("enabled").
  // The client-specific checks (Sage, RDPGuard, IRIS/INVU, Sage SQL,
  // StorageCraft) also skip themselves automatically when the application is
  // not installed on the server, so leaving them enabled is safe.
  checks: {
    schedule: { dayOfWeek: 'monday', hour: 7, minute: 0 },
    // Windows Server Backup — always applies.
    windowsServerBackup: { enabled: true, maxAgeHours: 48 },
    // Sage 50 Accounts file backups (auto-discovered).
    sage: { enabled: true, staleHours: 48 },
    // RDPGuard service running.
    rdpguard: { enabled: true },
    // IRIS / INVU backups. backupPath must point at the IRIS backup folder.
    irisInvu: { enabled: true, backupPath: '', staleHours: 48 },
    // Sage SQL backups. Add one or more folders to scan for .bak/.zip.
    sageSql: { enabled: true, paths: [], staleHours: 48 },
    // StorageCraft ShadowProtect SPX backup jobs (parsed from SPX logs).
    storagecraft: { enabled: true, staleHours: 48 },
  },
};
