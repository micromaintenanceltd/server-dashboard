// Agent auto-update.
//
// How it works (all outbound, never accepts inbound commands):
//   1. Ask the dashboard which agent version is APPROVED for rollout
//      (GET /api/agent/latest, authenticated with this server's key). The
//      dashboard is the control plane: nothing installs until an admin has
//      approved a version there, and the same switch can disable rollout
//      (kill switch) at any time.
//   2. If the approved version is newer than the one running, download the
//      installer from the (public) GitHub release URL the dashboard reports.
//   3. VERIFY the SHA-256 against the value the dashboard reported BEFORE the
//      installer is ever executed. This is the critical safety control: the
//      agent runs the installer as SYSTEM, so a wrong/tampered file is refused.
//      (To push a malicious update an attacker would need BOTH the GitHub
//      release and the dashboard's approval record.)
//   4. Launch the installer silently via a one-time Scheduled Task running as
//      SYSTEM, so it survives this service being stopped mid-upgrade. The
//      installer stops the old service, swaps binaries (config/enrolment are
//      preserved), and starts the new version.
//
// Opt-in per server: config.update.enabled (default true). A technician can
// untick "Automatic updates" on the local settings page to pin a server.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { readState, writeState } = require('./lib/state');

const AGENT_VERSION = require('../package.json').version;
const UPDATE_TASK = 'MMLServerAgentUpdate';
const SERVICE_NAME = 'MMLServerMonitor';
const MAX_ATTEMPTS_PER_VERSION = 3; // give up on a version after this many fails

// Compare dotted numeric versions. Returns 1 if a>b, -1 if a<b, 0 if equal.
function cmpVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Only ever download from the public GitHub release host (defence in depth even
// though the SHA-256 is also verified).
function isHttpsGithub(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    const h = url.hostname.toLowerCase();
    return (
      h === 'github.com' ||
      h.endsWith('.github.com') ||
      h.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

async function fetchApprovedRelease(cfg) {
  const url = cfg.apiUrl.replace(/\/+$/, '') + '/api/agent/latest';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

async function downloadTo(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

function execFileP(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message || '').trim()));
      resolve(String(stdout || ''));
    });
  });
}

// Launch the installer through a one-time Scheduled Task as SYSTEM. Using the
// task scheduler (rather than a child process) means the installer runs in its
// own lifetime and is NOT killed when the installer stops our service. A tiny
// .cmd wrapper avoids schtasks's argument-quoting pitfalls.
async function launchInstaller(installerPath, log) {
  const tmp = os.tmpdir();
  const logPath = path.join(tmp, 'mml-agent-update-install.log');
  const cmdPath = path.join(tmp, 'mml-agent-update-run.cmd');
  // Stop the service and wait until it is actually STOPPED (up to ~30s) before
  // launching the installer, so the agent's files are not in use when Setup
  // replaces them. The installer also stops the service itself, so this is
  // belt-and-braces, but doing it here means the binaries are already free by
  // the time Setup runs - avoiding the "could not close application" abort.
  const cmd =
    '@echo off\r\n' +
    `net stop ${SERVICE_NAME} >nul 2>&1\r\n` +
    'setlocal enabledelayedexpansion\r\n' +
    'set /a n=0\r\n' +
    ':wait\r\n' +
    `sc query ${SERVICE_NAME} | find "STOPPED" >nul\r\n` +
    'if not errorlevel 1 goto go\r\n' +
    'set /a n+=1\r\n' +
    'if !n! geq 15 goto go\r\n' +
    'timeout /t 2 /nobreak >nul\r\n' +
    'goto wait\r\n' +
    ':go\r\n' +
    'timeout /t 3 /nobreak >nul\r\n' +
    `"${installerPath}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL /LOG="${logPath}"\r\n`;
  fs.writeFileSync(cmdPath, cmd);

  // Create/replace the task (placeholder time), then run it immediately.
  await execFileP('schtasks', [
    '/create', '/tn', UPDATE_TASK, '/tr', cmdPath,
    '/sc', 'once', '/st', '23:59', '/ru', 'SYSTEM', '/rl', 'HIGHEST', '/f',
  ]);
  await execFileP('schtasks', ['/run', '/tn', UPDATE_TASK]);
  log.warn(
    `Update: installer launched via scheduled task "${UPDATE_TASK}". ` +
      'The service will be restarted on the new version shortly.'
  );
}

// Remove a leftover update task + temp files. Called on startup, so a server
// that has just upgraded tidies up after itself.
async function cleanupAfterUpdate() {
  try {
    await execFileP('schtasks', ['/delete', '/tn', UPDATE_TASK, '/f']);
  } catch {
    // no task present - fine
  }
  for (const f of ['mml-agent-update-run.cmd']) {
    try {
      fs.rmSync(path.join(os.tmpdir(), f), { force: true });
    } catch {
      /* best effort */
    }
  }
}

// Check for an approved newer version and, if found + verified, install it.
// Never throws: any failure is logged and the loop carries on.
async function checkAndMaybeUpdate(cfg, log) {
  const upd = cfg.update || {};
  if (upd.enabled === false) return; // pinned on this server

  let latest;
  try {
    latest = await fetchApprovedRelease(cfg);
  } catch (err) {
    log.warn(`Update check failed: ${err.message}`);
    return;
  }

  if (!latest || !latest.enabled || !latest.version) return; // nothing approved
  if (cmpVersions(latest.version, AGENT_VERSION) <= 0) return; // not newer

  const sha = String(latest.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    log.error('Update: refusing - approved release has no valid SHA-256.');
    return;
  }
  if (!isHttpsGithub(latest.downloadUrl)) {
    log.error(`Update: refusing - download URL is not an https GitHub URL: ${latest.downloadUrl}`);
    return;
  }

  // Don't thrash on a version that keeps failing (e.g. a bad release); wait for
  // a new approved version to reset.
  const state = readState();
  const failed = state.updateFailed || {};
  if ((failed[latest.version] || 0) >= MAX_ATTEMPTS_PER_VERSION) {
    log.warn(
      `Update: skipping ${latest.version} - failed ${failed[latest.version]} times already. ` +
        'Approve a newer version to retry.'
    );
    return;
  }

  log.warn(`Update: approved version ${latest.version} > installed ${AGENT_VERSION}. Downloading...`);
  const dest = path.join(os.tmpdir(), `mml-agent-setup-${latest.version}.exe`);
  try {
    const bytes = await downloadTo(latest.downloadUrl, dest);
    const got = (await sha256File(dest)).toLowerCase();
    if (got !== sha) {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
      throw new Error(`SHA-256 mismatch (expected ${sha.slice(0, 12)}…, got ${got.slice(0, 12)}…)`);
    }
    log.warn(`Update: downloaded ${bytes} bytes, SHA-256 verified. Installing ${latest.version}.`);
    await launchInstaller(dest, log);
    // The installer will stop this service shortly; nothing more to do.
  } catch (err) {
    failed[latest.version] = (failed[latest.version] || 0) + 1;
    state.updateFailed = failed;
    try {
      writeState(state);
    } catch {
      /* best effort */
    }
    log.error(`Update to ${latest.version} failed (attempt ${failed[latest.version]}): ${err.message}`);
  }
}

module.exports = {
  checkAndMaybeUpdate,
  cleanupAfterUpdate,
  cmpVersions,
  AGENT_VERSION,
};
