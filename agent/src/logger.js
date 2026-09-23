// Timestamped logger that writes to BOTH the console and a log file.
//
// Why the file sink matters: when the agent runs as a Windows service
// (LocalSystem, session 0) its stdout/stderr are pipes owned by the service
// wrapper. If that handle is ever invalid or closed, a bare `console.log` throws
// synchronously and, because it is the very first thing the service does, the
// process dies before printing anything - a silent crash that is almost
// impossible to diagnose. So every console write is wrapped in try/catch (a
// failed console write must never crash the agent), and every line is also
// appended synchronously to <exe dir>\logs\agent.log, which survives even an
// immediate process.exit(). Read that file to see why a service start failed.

const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveLogFile() {
  try {
    // pkg build: alongside the executable (Program Files\MML\Server Agent).
    // From source: the agent root.
    const base = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
    const dir = path.join(base, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'agent.log');
  } catch {
    try {
      return path.join(os.tmpdir(), 'mml-agent.log');
    } catch {
      return null;
    }
  }
}

const LOG_FILE = resolveLogFile();
const MAX_BYTES = 2 * 1024 * 1024; // roll at 2 MB so the file cannot grow forever

function fmt(a) {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function writeFile(line) {
  if (!LOG_FILE) return;
  try {
    // Cheap size-based roll: rename to .1 when it gets large.
    let size = 0;
    try {
      size = fs.statSync(LOG_FILE).size;
    } catch {}
    if (size > MAX_BYTES) {
      try {
        fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      } catch {}
    }
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // A failed file write must never crash the agent.
  }
}

function emit(consoleFn, level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ` + args.map(fmt).join(' ');
  try {
    consoleFn(line);
  } catch {
    // stdout/stderr handle may be invalid under the service - ignore.
  }
  writeFile(line);
}

module.exports = {
  info: (...args) => emit(console.log, 'info', args),
  warn: (...args) => emit(console.warn, 'warn', args),
  error: (...args) => emit(console.error, 'error', args),
  logFilePath: LOG_FILE,
};
