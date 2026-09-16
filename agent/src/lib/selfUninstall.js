// Self-uninstall, triggered when the dashboard marks this server for
// decommission (the agent learns this from its own outbound report response).
//
// Safety: this only removes files when running as the packaged, installed exe
// (process.pkg). Running from source in dev never deletes anything.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { configDir } = require('../config');
const { deregister } = require('../report');
const log = require('../logger');

// Inno Setup leaves an uninstaller named unins000.exe (unins001.exe, ...).
function findInnoUninstaller(dir) {
  try {
    const f = fs.readdirSync(dir).find((n) => /^unins\d{3}\.exe$/i.test(n));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

function spawnDetached(cmd, args) {
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function triggerSelfUninstall(cfg) {
  const dir = configDir();

  // Never delete files when running from source (dir would be the repo).
  if (!process.pkg) {
    log.warn('Decommission received, but running from source (not packaged). Deregistering only; not deleting files.');
    await deregister(cfg);
    return;
  }

  log.warn(`Decommission requested by dashboard. Uninstalling agent from ${dir} ...`);

  const uninstaller = findInnoUninstaller(dir);
  if (uninstaller) {
    // The installer's uninstaller deregisters (its UninstallRun) and removes the
    // service and files. Launch it detached and silent so it survives this
    // process being stopped.
    log.info(`Launching uninstaller: ${uninstaller}`);
    spawnDetached('cmd', ['/c', 'start', '', '/min', uninstaller, '/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES']);
    return;
  }

  // Fallback for installs without an Inno uninstaller (e.g. the PowerShell test
  // installer): deregister now, then a detached script stops/removes the service
  // and deletes the folder.
  log.info('No Inno uninstaller found; using fallback self-uninstall.');
  await deregister(cfg);

  const svcExe = path.join(dir, 'mml-agent-service.exe');
  const script = [
    '@echo off',
    'ping 127.0.0.1 -n 4 >nul',
    `"${svcExe}" stop`,
    `"${svcExe}" uninstall`,
    'ping 127.0.0.1 -n 3 >nul',
    `rmdir /s /q "${dir}"`,
  ].join('\r\n');
  const cmdPath = path.join(os.tmpdir(), `mml-uninstall-${Date.now()}.cmd`);
  try {
    fs.writeFileSync(cmdPath, script, 'utf8');
    spawnDetached('cmd', ['/c', 'start', '', '/min', cmdPath]);
  } catch (err) {
    log.error('Fallback self-uninstall failed to launch:', err.message);
  }
}

module.exports = { triggerSelfUninstall };
