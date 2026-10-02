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

  // LAN ping monitors: [{ name, host }]. Configured per server on the local
  // settings page. The dashboard alerts when a target stops responding.
  pingTargets: [],

  // Local settings web page, served on loopback only (127.0.0.1).
  settings: { enabled: true, port: 8000 },

  // Automatic agent updates. When enabled, the agent checks the dashboard daily
  // for an admin-approved newer version, verifies its SHA-256, and installs it.
  // Turn off ("Automatic updates" tickbox) to pin a server to its current build.
  update: { enabled: true, hour: 3, minute: 0 },

  // Weekly check run configuration. Runs once a week at the scheduled UK time.
  // Each check is ticked on/off per server in the local settings page
  // ("enabled"). The client-specific checks default to OFF so each server is
  // explicitly configured for what it runs; a technician enables the ones that
  // apply. An enabled check whose app/prerequisite isn't present reports a
  // warning (rather than silently skipping), so misconfiguration is visible.
  checks: {
    schedule: { dayOfWeek: 'monday', hour: 7, minute: 0 },
    // Windows Server Backup — applies to every server, on by default.
    windowsServerBackup: { enabled: true, maxAgeHours: 48 },
    // Sage 50 Accounts file backups (auto-discovered).
    sage: { enabled: false, staleHours: 48 },
    // RDPGuard service running.
    rdpguard: { enabled: false },
    // IRIS / INVU backups. backupPath must point at the IRIS backup folder.
    irisInvu: { enabled: false, backupPath: '', staleHours: 48 },
    // Sage SQL backups. Add one or more folders to scan for .bak/.zip.
    sageSql: { enabled: false, paths: [], staleHours: 48 },
    // StorageCraft ShadowProtect SPX backup jobs (parsed from SPX logs).
    storagecraft: { enabled: false, staleHours: 48 },
  },
};
