// Uninstalls the MML agent Windows service.
//
// Run from an ELEVATED (Administrator) command prompt:
//   npm run uninstall-service

const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'MML Server Agent',
  script: path.join(__dirname, 'src', 'agent.js'),
});

svc.on('uninstall', () => {
  console.log('MML Server Agent service uninstalled.');
});

svc.on('error', (err) => {
  console.error('Service error:', err);
});

console.log('Uninstalling MML Server Agent service (requires Administrator)...');
svc.uninstall();
