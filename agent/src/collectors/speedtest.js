// Daily internet speed test. Measures download/upload throughput and latency
// against Cloudflare's public speed endpoints (the same backend speed.cloudflare
// .com uses). Pure outbound HTTPS, no extra dependencies, no bundled binary.
//
// It's an indicative test (a few parallel streams), not a lab-grade benchmark -
// enough to see a client's connection speed and spot a degradation over time.

const DOWN_URL = 'https://speed.cloudflare.com/__down';
const UP_URL = 'https://speed.cloudflare.com/__up';

const DOWN_BYTES = 6_250_000; // per stream (~6.25 MB x 4 = 25 MB)
const DOWN_STREAMS = 4;
const UP_BYTES = 5_000_000; // per stream (~5 MB x 2 = 10 MB)
const UP_STREAMS = 2;
const TIMEOUT_MS = 60_000;

function timeoutSignal() {
  // AbortSignal.timeout is available in Node 18+/undici (our pkg runtime is 22).
  try {
    return AbortSignal.timeout(TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

async function measureLatency() {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    try {
      await fetch(`${DOWN_URL}?bytes=0`, { cache: 'no-store', signal: timeoutSignal() }).then((r) =>
        r.arrayBuffer()
      );
      samples.push(Date.now() - t0);
    } catch {
      /* ignore a failed sample */
    }
  }
  return samples.length ? Math.min(...samples) : null;
}

async function measureDownload() {
  const start = Date.now();
  const bufs = await Promise.all(
    Array.from({ length: DOWN_STREAMS }, () =>
      fetch(`${DOWN_URL}?bytes=${DOWN_BYTES}`, { cache: 'no-store', signal: timeoutSignal() }).then(
        (r) => r.arrayBuffer()
      )
    )
  );
  const secs = (Date.now() - start) / 1000;
  const bytes = bufs.reduce((a, b) => a + b.byteLength, 0);
  return secs > 0 ? (bytes * 8) / secs / 1e6 : null;
}

async function measureUpload() {
  const body = Buffer.alloc(UP_BYTES);
  const start = Date.now();
  await Promise.all(
    Array.from({ length: UP_STREAMS }, () =>
      fetch(UP_URL, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/octet-stream' },
        signal: timeoutSignal(),
      }).then((r) => r.text())
    )
  );
  const secs = (Date.now() - start) / 1000;
  const bytes = UP_BYTES * UP_STREAMS;
  return secs > 0 ? (bytes * 8) / secs / 1e6 : null;
}

// Run the full test. Returns { down_mbps, up_mbps, ping_ms, server, tested_at }
// or null if it couldn't measure anything (e.g. the endpoint is blocked).
async function runSpeedTest() {
  try {
    const ping_ms = await measureLatency();
    const down_mbps = await measureDownload();
    const up_mbps = await measureUpload();
    if (down_mbps == null && up_mbps == null) return null;
    const round1 = (v) => (v != null ? Math.round(v * 10) / 10 : null);
    return {
      down_mbps: round1(down_mbps),
      up_mbps: round1(up_mbps),
      ping_ms: ping_ms,
      server: 'Cloudflare',
      tested_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

module.exports = { runSpeedTest };
