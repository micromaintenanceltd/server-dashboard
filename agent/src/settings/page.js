// The local settings page, served by the agent on 127.0.0.1. Self-contained
// HTML + JS (no external requests). Exported as a string.

const PAGE = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MML Server Agent settings</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, Segoe UI, Arial, sans-serif; background: #f1f5f9; color: #0f172a; }
  header { background: #0f172a; color: #fff; padding: 14px 20px; display: flex; align-items: center; gap: 12px; }
  header .logo { background: #2563eb; width: 34px; height: 34px; border-radius: 6px; display: grid; place-items: center; font-weight: 700; }
  header .sub { color: #94a3b8; font-size: 12px; }
  main { max-width: 860px; margin: 0 auto; padding: 20px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; margin-bottom: 16px; }
  .card h2 { margin: 0 0 12px; font-size: 15px; }
  label { display: block; font-size: 12px; color: #475569; margin: 10px 0 4px; }
  input[type=text], input[type=number], input[type=password], select, textarea {
    width: 100%; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; background: #fff;
  }
  textarea { font-family: ui-monospace, Consolas, monospace; font-size: 12px; min-height: 96px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .row > div { flex: 1; min-width: 140px; }
  .check { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .check input { width: auto; }
  .muted { color: #64748b; font-size: 12px; }
  .btns { display: flex; gap: 10px; flex-wrap: wrap; position: sticky; bottom: 0; background: #f1f5f9; padding: 12px 0; }
  button { border: 0; border-radius: 6px; padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer; }
  .primary { background: #2563eb; color: #fff; }
  .ghost { background: #fff; border: 1px solid #cbd5e1; color: #334155; }
  #toast { position: fixed; right: 16px; bottom: 16px; padding: 10px 14px; border-radius: 6px; color: #fff; opacity: 0; transition: opacity .2s; }
  #toast.ok { background: #16a34a; } #toast.err { background: #dc2626; }
  #toast.show { opacity: 1; }
  .reveal { display: flex; gap: 8px; align-items: center; }
  .reveal button { padding: 6px 10px; font-weight: 500; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<header>
  <div class="logo">MML</div>
  <div>
    <div style="font-weight:600">Server Agent settings</div>
    <div class="sub" id="hostline">Local configuration</div>
  </div>
</header>
<main>
  <div class="card">
    <h2>Connection</h2>
    <label>Dashboard API URL</label>
    <input id="apiUrl" type="text" placeholder="https://mml-dashboard-api.example.workers.dev" />
    <label>API key (per-server)</label>
    <div class="reveal">
      <input id="apiKey" type="password" placeholder="mml_..." />
      <button class="ghost" type="button" onclick="toggleKey()">Show</button>
    </div>
    <p class="muted">This key authenticates this server to the dashboard. Changing it here changes what this one server uses.</p>
  </div>

  <div class="card">
    <h2>Live monitoring</h2>
    <div class="row">
      <div><label>Report interval (minutes)</label><input id="intervalMinutes" type="number" min="1" /></div>
      <div><label>Top processes to include</label><input id="topProcessCount" type="number" min="0" /></div>
    </div>
    <label>Antivirus product name</label>
    <input id="avProduct" type="text" />
    <label>AV service names (comma separated)</label>
    <input id="avServiceNames" type="text" />
    <label>Watched services (JSON array of {name, displayName, critical})</label>
    <textarea id="watchServices"></textarea>
  </div>

  <div class="card">
    <h2>Weekly checks</h2>
    <div class="row">
      <div><label>Day</label>
        <select id="schedDay">
          <option>monday</option><option>tuesday</option><option>wednesday</option>
          <option>thursday</option><option>friday</option><option>saturday</option><option>sunday</option>
        </select>
      </div>
      <div><label>Hour (0-23, UK time)</label><input id="schedHour" type="number" min="0" max="23" /></div>
      <div><label>Minute</label><input id="schedMin" type="number" min="0" max="59" /></div>
    </div>

    <div id="checkToggles" style="margin-top:12px"></div>

    <label style="margin-top:12px">Required services (JSON array of {name, displayName})</label>
    <textarea id="requiredServices"></textarea>
    <p class="muted">These must be running or the weekly check fails. Use exact Windows service names.</p>
  </div>

  <div class="btns">
    <button class="primary" onclick="save()">Save settings</button>
    <button class="ghost" onclick="act('test-connection','Testing...')">Test connection</button>
    <button class="ghost" onclick="act('send-report','Sending report...')">Send report now</button>
    <button class="ghost" onclick="act('run-check','Running checks...')">Run checks now</button>
  </div>
  <p class="muted">Changes apply within a minute. The interval change restarts the reporting timer automatically.</p>
</main>
<div id="toast"></div>

<script>
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'mml-settings' };
let current = {};

function toast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = (ok ? 'ok' : 'err') + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}
function toggleKey() {
  const el = document.getElementById('apiKey');
  el.type = el.type === 'password' ? 'text' : 'password';
}

// The list of checks with the numeric thresholds we expose per check.
const CHECK_FIELDS = {
  windowsServerBackup: ['maxAgeHours'],
  requiredServices: [],
  diskSpace: ['warnFreePercent', 'failFreePercent'],
  pendingUpdates: ['failCount'],
  lastUpdate: ['maxDays'],
  antivirus: ['scanStaleDays'],
  pendingReboot: [],
  firewall: [],
  eventLogErrors: ['days', 'warnCount'],
};
const CHECK_LABELS = {
  windowsServerBackup: 'Windows Server Backup',
  requiredServices: 'Required services',
  diskSpace: 'Disk space',
  pendingUpdates: 'Pending updates',
  lastUpdate: 'Last update installed',
  antivirus: 'Antivirus',
  pendingReboot: 'Pending reboot',
  firewall: 'Windows Firewall',
  eventLogErrors: 'Event log errors',
};

function renderToggles(checks) {
  const wrap = document.getElementById('checkToggles');
  wrap.innerHTML = '';
  for (const key of Object.keys(CHECK_FIELDS)) {
    const cfg = checks[key] || {};
    const row = document.createElement('div');
    row.className = 'check';
    const enabled = cfg.enabled !== false;
    let html = '<input type="checkbox" id="en_' + key + '"' + (enabled ? ' checked' : '') + ' />';
    html += '<label style="margin:0;min-width:170px;color:#0f172a">' + CHECK_LABELS[key] + '</label>';
    for (const f of CHECK_FIELDS[key]) {
      const v = cfg[f] != null ? cfg[f] : '';
      html += '<span style="font-size:12px;color:#64748b">' + f + '</span>' +
              '<input type="number" id="f_' + key + '_' + f + '" value="' + v + '" style="width:90px" />';
    }
    row.innerHTML = html;
    wrap.appendChild(row);
  }
}

async function load() {
  const r = await fetch('/api/config', { headers: H });
  current = await r.json();
  document.getElementById('apiUrl').value = current.apiUrl || '';
  document.getElementById('apiKey').value = current.apiKey || '';
  document.getElementById('intervalMinutes').value = current.intervalMinutes || 5;
  document.getElementById('topProcessCount').value = current.topProcessCount ?? 5;
  document.getElementById('avProduct').value = current.avProduct || '';
  document.getElementById('avServiceNames').value = (current.avServiceNames || []).join(', ');
  document.getElementById('watchServices').value = JSON.stringify(current.watchServices || [], null, 2);
  const checks = current.checks || {};
  const sch = checks.schedule || { dayOfWeek: 'monday', hour: 7, minute: 0 };
  document.getElementById('schedDay').value = sch.dayOfWeek || 'monday';
  document.getElementById('schedHour').value = sch.hour ?? 7;
  document.getElementById('schedMin').value = sch.minute ?? 0;
  renderToggles(checks);
  const req = (checks.requiredServices && (checks.requiredServices.list || checks.requiredServices)) || [];
  document.getElementById('requiredServices').value = JSON.stringify(Array.isArray(req) ? req : [], null, 2);
  document.getElementById('hostline').textContent = 'Local configuration for ' + (current._hostname || 'this server');
}

function buildConfig() {
  const cfg = JSON.parse(JSON.stringify(current));
  cfg.apiUrl = document.getElementById('apiUrl').value.trim();
  cfg.apiKey = document.getElementById('apiKey').value.trim();
  cfg.intervalMinutes = Number(document.getElementById('intervalMinutes').value) || 5;
  cfg.topProcessCount = Number(document.getElementById('topProcessCount').value) || 0;
  cfg.avProduct = document.getElementById('avProduct').value.trim();
  cfg.avServiceNames = document.getElementById('avServiceNames').value.split(',').map(s => s.trim()).filter(Boolean);
  cfg.watchServices = JSON.parse(document.getElementById('watchServices').value || '[]');

  const checks = cfg.checks || (cfg.checks = {});
  checks.schedule = {
    dayOfWeek: document.getElementById('schedDay').value,
    hour: Number(document.getElementById('schedHour').value) || 0,
    minute: Number(document.getElementById('schedMin').value) || 0,
  };
  for (const key of Object.keys(CHECK_FIELDS)) {
    const c = checks[key] && typeof checks[key] === 'object' && !Array.isArray(checks[key]) ? checks[key] : {};
    c.enabled = document.getElementById('en_' + key).checked;
    for (const f of CHECK_FIELDS[key]) {
      const el = document.getElementById('f_' + key + '_' + f);
      if (el && el.value !== '') c[f] = Number(el.value);
    }
    checks[key] = c;
  }
  checks.requiredServices = { list: JSON.parse(document.getElementById('requiredServices').value || '[]') };
  return cfg;
}

async function save() {
  let cfg;
  try { cfg = buildConfig(); }
  catch (e) { return toast('Invalid JSON in one of the list fields: ' + e.message, false); }
  if (!cfg.apiUrl || !cfg.apiKey) return toast('API URL and API key are required.', false);
  const r = await fetch('/api/config', { method: 'POST', headers: H, body: JSON.stringify(cfg) });
  const body = await r.json().catch(() => ({}));
  if (r.ok) { toast('Settings saved.', true); current = cfg; }
  else toast('Save failed: ' + (body.error || r.status), false);
}

async function act(path, msg) {
  toast(msg, true);
  const r = await fetch('/api/' + path, { method: 'POST', headers: H });
  const body = await r.json().catch(() => ({}));
  if (r.ok) toast(body.message || 'Done.', true);
  else toast('Failed: ' + (body.error || r.status), false);
}

load().catch(e => toast('Could not load config: ' + e.message, false));
</script>
</body>
</html>`;

module.exports = { PAGE };
