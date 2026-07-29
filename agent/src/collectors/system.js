// System metrics from Node's built-in `os` module: CPU %, RAM, uptime, and
// host metadata (hostname, OS version, local IP). No external process needed.

const os = require('os');

// Instantaneous CPU usage as a percentage, sampled over `sampleMs`.
// os.cpus() reports cumulative tick counters; we diff two samples to get the
// busy fraction across all cores.
function cpuPercent(sampleMs = 500) {
  return new Promise((resolve) => {
    const start = cpuTimes();
    setTimeout(() => {
      const end = cpuTimes();
      const idle = end.idle - start.idle;
      const total = end.total - start.total;
      const used = total > 0 ? (1 - idle / total) * 100 : 0;
      resolve(round(used, 1));
    }, sampleMs);
  });
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const type of Object.keys(cpu.times)) total += cpu.times[type];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function memory() {
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMb = Math.round(os.freemem() / (1024 * 1024));
  return { ram_used_mb: totalMb - freeMb, ram_total_mb: totalMb };
}

function uptimeSeconds() {
  return Math.round(os.uptime());
}

// Best-effort local IPv4: first non-internal IPv4 address.
function localIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'unknown';
}

function meta(agentVersion) {
  return {
    hostname: os.hostname(),
    // os.version() gives a readable Windows build string on Node 18+.
    os_version: `${os.type()} ${os.release()} (${os.version()})`,
    local_ip: localIp(),
    agent_version: agentVersion,
  };
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

module.exports = { cpuPercent, memory, uptimeSeconds, meta };
