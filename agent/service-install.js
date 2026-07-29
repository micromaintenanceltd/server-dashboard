// Installs the MML agent as a Windows service using node-windows.
//
// Run from an ELEVATED (Administrator) command prompt on the target server:
//   npm run install-service
//
// node-windows wraps the script in a Windows service via winsw, sets it to
// start automatically at boot, and restarts it if it crashes. Logs are written
// to daemon\ next to agent.js (mml-server-agent.out.log / .err.log).

const path = require('path');
const { Service } = require('node-windows');

// Sanity check: make sure config.json exists before installing, otherwise the
// service would install but fail to start.
const fs = require('fs');
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(
    'config.json not found. Copy config.example.json to config.json and fill ' +
      'it in before installing the service.'
  );
  process.exit(1);
}

const svc = new Service({
  name: 'MML Server Agent',
  description: 'Micro Maintenance server monitoring agent. Reports health to the MML dashboard.',
  script: path.join(__dirname, 'src', 'agent.js'),
  // Restart with a short backoff if the process exits unexpectedly.
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  // Keep the working directory at the agent root so config.json resolves.
  workingDirectory: __dirname,
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('Service is already installed.');
});

svc.on('start', () => {
  console.log('MML Server Agent started. Check the dashboard for a fresh report shortly.');
});

svc.on('error', (err) => {
  console.error('Service error:', err);
});

console.log('Installing MML Server Agent service (requires Administrator)...');
svc.install();
