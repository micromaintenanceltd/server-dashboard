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
};
