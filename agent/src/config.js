// Loads, validates, and writes the agent configuration.
//
// The config file is resolved in this order:
//   1. process.env.MML_AGENT_CONFIG (absolute path)
//   2. config.json next to the executable  (packaged install: Program Files)
//   3. config.json at the agent root        (running from source in dev)
//
// Keeping config.json beside the executable means the Windows service picks it
// up with no environment setup.

const fs = require('fs');
const path = require('path');

// The directory the config lives in. For a pkg-built exe this is the folder the
// exe was installed to; from source it is the agent root.
function configDir() {
  // `process.pkg` is set when running inside a pkg single-executable build.
  if (process.pkg) return path.dirname(process.execPath);
  return path.join(__dirname, '..');
}

function defaultConfigPath() {
  return path.join(configDir(), 'config.json');
}

function candidatePaths() {
  const candidates = [];
  if (process.env.MML_AGENT_CONFIG) candidates.push(process.env.MML_AGENT_CONFIG);
  candidates.push(path.join(configDir(), 'config.json'));
  // Dev fallback: agent root (covers running from source when packaged check misses).
  candidates.push(path.join(__dirname, '..', 'config.json'));
  return candidates;
}

function loadConfig() {
  const configPath = candidatePaths().find((p) => p && fs.existsSync(p));
  if (!configPath) {
    throw new Error(
      'No config found. Run the installer, or copy config.example.json to ' +
        'config.json and fill it in, or set MML_AGENT_CONFIG to a config path.'
    );
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Config file ${configPath} is not valid JSON: ${err.message}`);
  }

  // Required fields.
  if (!cfg.apiUrl) throw new Error('config.apiUrl is required.');
  if (!cfg.apiKey || cfg.apiKey.includes('PASTE')) {
    throw new Error('config.apiKey is required (run enrollment, or paste a key).');
  }

  // Defaults.
  cfg.intervalMinutes = Number(cfg.intervalMinutes) > 0 ? Number(cfg.intervalMinutes) : 5;
  cfg.avProduct = cfg.avProduct || 'Bitdefender GravityZone';
  cfg.avServiceNames = Array.isArray(cfg.avServiceNames) ? cfg.avServiceNames : [];
  cfg.watchServices = Array.isArray(cfg.watchServices) ? cfg.watchServices : [];
  cfg.topProcessCount = Number.isInteger(cfg.topProcessCount) ? cfg.topProcessCount : 5;
  cfg._configPath = configPath;

  return cfg;
}

// Write a config object to the default location (next to the executable).
// Returns the path written.
function writeConfig(cfg, targetPath) {
  const dest = targetPath || defaultConfigPath();
  fs.writeFileSync(dest, JSON.stringify(cfg, null, 2) + '\n', { encoding: 'utf8' });
  return dest;
}

module.exports = { loadConfig, writeConfig, defaultConfigPath, configDir };
