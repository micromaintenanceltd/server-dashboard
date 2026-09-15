// Local settings web server, bound to loopback only (127.0.0.1).
//
// Security posture:
//   - Binds to 127.0.0.1, so it is unreachable from the LAN or internet. Only
//     someone already on this server (console/RDP) can open it. The central hub
//     still cannot reach or change this server.
//   - Write/API endpoints require a custom header and a matching Host/Origin,
//     which blocks CSRF from any other site a local browser might visit.
//
// It reads and writes the same config.json the agent uses, and applies changes
// to the running loops via the applyConfig callback.

const http = require('http');
const { PAGE } = require('./page');
const os = require('os');

const { collectReport, postReport, postCheckRun } = require('../report');
const { runAllChecks } = require('../checks');

// Start the server. deps:
//   getConfig()       -> the live config object
//   applyConfig(obj)  -> validate, persist, and apply to the running loops
//   log               -> logger
function startSettingsServer({ getConfig, applyConfig, log }) {
  const cfg = getConfig();
  const settings = cfg.settings || {};
  if (settings.enabled === false) {
    log.info('Local settings server disabled by config.');
    return null;
  }
  const port = Number(settings.port) > 0 ? Number(settings.port) : 8000;
  const host = '127.0.0.1'; // loopback only, never 0.0.0.0

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res, { getConfig, applyConfig, log, port });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  server.on('error', (err) => {
    log.error(`Settings server error on ${host}:${port}: ${err.message}`);
  });

  server.listen(port, host, () => {
    log.info(`Local settings page at http://${host}:${port} (loopback only).`);
  });

  return server;
}

async function handle(req, res, ctx) {
  const url = new URL(req.url, `http://127.0.0.1:${ctx.port}`);
  const path = url.pathname;

  // The settings page itself (document GET, no custom header needed).
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  // Everything under /api requires the CSRF guard.
  if (path.startsWith('/api/')) {
    if (!csrfOk(req, ctx.port)) {
      return json(res, 403, { error: 'Blocked: settings API must be called from the local page.' });
    }
  }

  if (req.method === 'GET' && path === '/api/config') {
    return json(res, 200, publicConfig(ctx.getConfig()));
  }

  if (req.method === 'POST' && path === '/api/config') {
    const body = await readJson(req);
    try {
      await ctx.applyConfig(body);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && path === '/api/test-connection') {
    const cfg = ctx.getConfig();
    try {
      const base = (cfg.apiUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/api/health`);
      return json(res, 200, { ok: r.ok, message: `API responded HTTP ${r.status}.` });
    } catch (err) {
      return json(res, 200, { ok: false, message: `Could not reach API: ${err.message}` });
    }
  }

  if (req.method === 'POST' && path === '/api/send-report') {
    const cfg = ctx.getConfig();
    try {
      const report = await collectReport(cfg);
      await postReport(cfg, report);
      return json(res, 200, { ok: true, message: 'Report sent to the dashboard.' });
    } catch (err) {
      return json(res, 200, { ok: false, message: `Report failed: ${err.message}` });
    }
  }

  if (req.method === 'POST' && path === '/api/run-check') {
    const cfg = ctx.getConfig();
    try {
      const results = await runAllChecks(cfg);
      await postCheckRun(cfg, results);
      const fail = results.filter((r) => r.status === 'fail').length;
      const warn = results.filter((r) => r.status === 'warn').length;
      return json(res, 200, {
        ok: true,
        message: `Check run sent: ${results.length} checks, ${fail} fail, ${warn} warn.`,
      });
    } catch (err) {
      return json(res, 200, { ok: false, message: `Check run failed: ${err.message}` });
    }
  }

  json(res, 404, { error: 'Not found' });
}

// CSRF guard: require our custom header and a loopback Host, and reject any
// cross-site Origin. Browsers cannot set X-Requested-With cross-origin without a
// CORS preflight, which we never approve.
function csrfOk(req, port) {
  if (req.headers['x-requested-with'] !== 'mml-settings') return false;

  const host = (req.headers.host || '').toLowerCase();
  const okHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!okHosts.includes(host)) return false;

  const origin = req.headers.origin;
  if (origin) {
    const okOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    if (!okOrigins.includes(origin.toLowerCase())) return false;
  }
  return true;
}

// The config we return to the page. Strips internal fields; adds hostname.
function publicConfig(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  out._hostname = os.hostname();
  return out;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('Body too large.'));
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

module.exports = { startSettingsServer };
