// `enroll` command: self-register this server with the dashboard and write
// config.json with the returned per-server key.
//
// Called by the installer during setup, for example:
//   mml-agent.exe enroll --company "Acme Ltd" \
//       --api-url https://mml-dashboard-api.example.workers.dev \
//       --enroll-token <token> [--location "Leeds HQ"]
//
// The hostname is detected automatically. The API URL and enrollment token are
// supplied by the installer (baked into the signed setup.exe at build time).
// They can also come from MML_API_URL / MML_ENROLL_TOKEN env vars as a fallback.

const os = require('os');
const { writeConfig, defaultConfigPath } = require('../config');
const defaults = require('../defaults');
const log = require('../logger');

// Minimal --flag value parser.
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function enroll(argv) {
  const args = parseArgs(argv);

  const company = (args.company || '').toString().trim();
  const apiUrl = (args['api-url'] || process.env.MML_API_URL || '').toString().trim();
  const enrollToken = (args['enroll-token'] || process.env.MML_ENROLL_TOKEN || '')
    .toString()
    .trim();
  const location = (args.location || '').toString().trim();
  const hostname = (args.hostname || os.hostname()).toString().trim();
  const interval = Number(args.interval) > 0 ? Number(args.interval) : defaults.intervalMinutes;

  const missing = [];
  if (!company) missing.push('--company');
  if (!apiUrl) missing.push('--api-url (or MML_API_URL)');
  if (!enrollToken) missing.push('--enroll-token (or MML_ENROLL_TOKEN)');
  if (missing.length) {
    log.error(`Enrollment needs: ${missing.join(', ')}`);
    process.exit(2);
    return;
  }

  const base = apiUrl.replace(/\/+$/, '');
  log.info(`Enrolling ${hostname} for "${company}" at ${base} ...`);

  let res;
  try {
    res = await fetch(`${base}/api/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${enrollToken}`,
      },
      body: JSON.stringify({
        company_name: company,
        hostname,
        location: location || undefined,
      }),
    });
  } catch (err) {
    log.error(`Could not reach the API: ${err.message}`);
    process.exit(1);
    return;
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text };
  }

  if (!res.ok) {
    log.error(`Enrollment failed (${res.status}): ${body.error || text}`);
    process.exit(1);
    return;
  }

  // Build config.json from the returned key plus sensible defaults. The
  // enrollment token is deliberately NOT written to disk; it is only needed at
  // install time.
  const cfg = {
    apiUrl: base,
    apiKey: body.api_key,
    intervalMinutes: interval,
    avProduct: defaults.avProduct,
    avServiceNames: defaults.avServiceNames,
    watchServices: defaults.watchServices,
    topProcessCount: defaults.topProcessCount,
  };

  const written = writeConfig(cfg);
  log.info(
    `Enrolled ${body.reenrolled ? '(re-enrolled existing record)' : '(new record created)'}: ` +
      `server "${body.name}" for "${body.client_name}". Config written to ${written}.`
  );
  log.info('The dashboard will show this server, and it goes Online after the first report.');
}

module.exports = { enroll, defaultConfigPathForHelp: defaultConfigPath };
