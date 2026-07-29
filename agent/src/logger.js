// Minimal timestamped logger. When running as a Windows service, stdout/stderr
// are captured by node-windows into the service's log files.

function ts() {
  return new Date().toISOString();
}

module.exports = {
  info: (...args) => console.log(`[${ts()}] [info]`, ...args),
  warn: (...args) => console.warn(`[${ts()}] [warn]`, ...args),
  error: (...args) => console.error(`[${ts()}] [error]`, ...args),
};
