// Pings the configured LAN targets and reports which responded. Each target is
// { name, host } where host is an IP or hostname on the same network. Results
// feed the dashboard and drive "device not responding" alerts.
//
// Safety: we shell out to the Windows `ping` via execFile with an argument array
// (no shell), and we reject any host that isn't a plain IP/hostname, so a target
// value can never inject extra arguments or commands.

const { execFile } = require('child_process');

// Allow IPv4, IPv6 and hostnames; must not start with '-' (would look like a
// ping flag) and must contain no whitespace.
const HOST_OK = /^[A-Za-z0-9]([A-Za-z0-9._:-]*[A-Za-z0-9])?$/;

function isValidHost(host) {
  return typeof host === 'string' && host.length <= 255 && HOST_OK.test(host);
}

function pingOne(host, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!isValidHost(host)) {
      resolve({ ok: false, rtt_ms: null, error: 'invalid host' });
      return;
    }
    // -n 2  : send 2 echo requests (tolerate a single dropped packet)
    // -w ms : wait this long for each reply
    execFile(
      'ping',
      ['-n', '2', '-w', String(timeoutMs), host],
      { windowsHide: true, timeout: timeoutMs * 4 + 2000 },
      (err, stdout) => {
        const out = String(stdout || '');
        // "Received = N" with N>0, or any "TTL=" line, means at least one reply.
        const ok = /Received = [1-9]/i.test(out) || /TTL=/i.test(out);
        const m = out.match(/Average = (\d+)ms/i);
        resolve({ ok, rtt_ms: m ? Number(m[1]) : null });
      }
    );
  });
}

// Ping all configured targets (in parallel) and return a result per target.
async function pingTargets(cfg) {
  const targets = Array.isArray(cfg.pingTargets) ? cfg.pingTargets : [];
  const valid = targets.filter((t) => t && isValidHost(t.host));
  const results = await Promise.all(
    valid.map(async (t) => {
      const r = await pingOne(String(t.host));
      return {
        name: (t.name && String(t.name).trim()) || String(t.host),
        host: String(t.host),
        ok: r.ok,
        rtt_ms: r.rtt_ms,
      };
    })
  );
  return results;
}

module.exports = { pingTargets, isValidHost };
