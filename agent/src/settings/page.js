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
  .checkblock { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin: 8px 0; background: #f8fafc; }
  .checkblock .head { display: flex; align-items: center; gap: 8px; }
  .checkblock .head input[type=checkbox] { width: 16px; height: 16px; }
  .checkblock .head .name { font-weight: 600; color: #0f172a; }
  .checkblock .desc { color: #64748b; font-size: 12px; margin: 4px 0 0 24px; }
  .checkblock .fields { margin: 8px 0 2px 24px; display: flex; gap: 14px; flex-wrap: wrap; }
  .checkblock .fields > div { min-width: 140px; }
  .checkblock.disabled { opacity: .55; }
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
  /* Modal overlay + box */
  .modal { display: none; position: fixed; inset: 0; z-index: 50; background: rgba(15,23,42,.45);
    align-items: center; justify-content: center; padding: 20px; }
  .modal.show { display: flex; }
  .modal-box { background: #fff; border-radius: 10px; width: 100%; max-width: 560px; max-height: 85vh;
    display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,.3); }
  .modal-box h3 { margin: 0; padding: 16px 18px; border-bottom: 1px solid #e2e8f0; font-size: 15px; }
  .modal-body { padding: 14px 18px; overflow: auto; }
  .modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid #e2e8f0; }
  .svc-search { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 10px; }
  .svc-row { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 8px;
    padding: 5px 2px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
  .svc-row .sname { color: #64748b; font-size: 11px; }
  .svc-row .crit { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #475569; white-space: nowrap; }
  .svc-row input { width: auto; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-left:6px; }
  .dot.on { background:#16a34a; } .dot.off { background:#dc2626; }
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
      <input id="apiKey" type="password" autocomplete="off" />
      <button class="ghost" type="button" onclick="toggleKey()">Show</button>
    </div>
    <p class="muted" id="apiKeyHint">This key authenticates this server to the dashboard. For security it is never shown here. Leave blank to keep the current key; type a new key only to rotate it.</p>
    <p class="muted">Saving changes asks for the shared MML settings password (verified with the dashboard, never stored here).</p>
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
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px">
      <label style="margin:0">Watched services</label>
      <button class="ghost" type="button" style="padding:6px 12px;font-weight:500" onclick="openServices()">Choose services…</button>
    </div>
    <p class="muted" id="watchSummary">No services watched.</p>
    <details style="margin-top:6px">
      <summary class="muted" style="cursor:pointer">Advanced: edit as JSON</summary>
      <textarea id="watchServices" style="margin-top:6px"></textarea>
    </details>
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

    <p class="muted" style="margin-top:12px">Tick the checks this server should run each week. Enable only the ones that apply here &mdash; an enabled check whose software isn't found reports a warning so misconfiguration is visible.</p>
    <div id="checkToggles" style="margin-top:6px"></div>
  </div>

  <div class="card">
    <h2>Maintenance</h2>
    <label style="display:flex;align-items:center;gap:10px;margin:0;cursor:pointer">
      <input id="updateEnabled" type="checkbox" style="width:auto;margin:0" />
      <span>Automatic updates</span>
    </label>
    <p class="muted" style="margin-top:8px">When ticked, this server checks the dashboard daily for an admin-approved newer agent version, verifies it, and installs it automatically. Untick to pin this server to its current version.</p>
  </div>

  <div class="card">
    <h2>Network monitors (LAN ping)</h2>
    <p class="muted" style="margin-top:0">Ping other devices on this network (by IP or hostname). You&apos;ll get a dashboard alert if one stops responding. Add as many as you need &mdash; the name is used in the alert.</p>
    <div id="pingList" style="margin-top:10px"></div>
    <button class="ghost" type="button" style="margin-top:8px;padding:6px 12px;font-weight:500" onclick="addPing()">+ Add device</button>
  </div>

  <div class="btns">
    <button class="primary" onclick="save()">Save settings</button>
    <button class="ghost" onclick="act('test-connection','Testing...')">Test connection</button>
    <button class="ghost" onclick="act('send-report','Sending report...', true)">Send report now</button>
    <button class="ghost" onclick="act('run-check','Running checks...', true)">Run checks now</button>
  </div>
  <p class="muted">Changes apply within a minute. The interval change restarts the reporting timer automatically.</p>
</main>

<!-- Settings password prompt -->
<div class="modal" id="pwModal">
  <div class="modal-box" style="max-width:400px">
    <h3>Settings password</h3>
    <div class="modal-body">
      <p class="muted" style="margin-top:0">Enter the shared MML settings password to save changes.</p>
      <input id="pwInput" type="password" autocomplete="off" placeholder="Password"
             onkeydown="if(event.key==='Enter')pwSubmit();if(event.key==='Escape')pwCancel();" />
    </div>
    <div class="modal-foot">
      <button class="ghost" onclick="pwCancel()">Cancel</button>
      <button class="primary" onclick="pwSubmit()">Unlock</button>
    </div>
  </div>
</div>

<!-- Service picker -->
<div class="modal" id="svcModal">
  <div class="modal-box">
    <h3>Choose watched services</h3>
    <div class="modal-body">
      <input class="svc-search" id="svcSearch" placeholder="Search services..." oninput="renderSvc()" />
      <p class="muted" style="margin:0 0 8px">Tick a service to watch it; tick <strong>Critical</strong> to alert when it stops.</p>
      <div id="svcList">Loading services...</div>
    </div>
    <div class="modal-foot">
      <span class="muted" id="svcCount" style="margin-right:auto"></span>
      <button class="ghost" onclick="closeServices()">Cancel</button>
      <button class="primary" onclick="applyServices()">Apply</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'mml-settings' };
let current = {};

// --- Settings password prompt (modal) ---
// Resolves to the password (from this session's cache, or by prompting). The
// password is cached in sessionStorage so we only ask once per browser session;
// a 403 on save clears it so the next attempt re-prompts.
let pwResolver = null;
function getSettingsPassword() {
  try {
    const cached = sessionStorage.getItem('mml_settings_password');
    if (cached) return Promise.resolve(cached);
  } catch {}
  const m = document.getElementById('pwModal');
  const inp = document.getElementById('pwInput');
  inp.value = '';
  m.classList.add('show');
  setTimeout(() => inp.focus(), 50);
  return new Promise((resolve, reject) => { pwResolver = { resolve, reject }; });
}
function pwSubmit() {
  const v = (document.getElementById('pwInput').value || '').trim();
  if (!v) return;
  try { sessionStorage.setItem('mml_settings_password', v); } catch {}
  document.getElementById('pwModal').classList.remove('show');
  if (pwResolver) { pwResolver.resolve(v); pwResolver = null; }
}
function pwCancel() {
  document.getElementById('pwModal').classList.remove('show');
  if (pwResolver) { pwResolver.reject(new Error('cancelled')); pwResolver = null; }
}
function pwHeaders(pw) {
  return Object.assign({}, H, { 'X-Settings-Password': pw });
}
function forgetPassword() {
  try { sessionStorage.removeItem('mml_settings_password'); } catch {}
}

function toast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = (ok ? 'ok' : 'err') + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}
function toggleKey() {
  const el = document.getElementById('apiKey');
  el.type = el.type === 'password' ? 'text' : 'password';
}
// MML's six weekly checks, in display order. Each has a tickbox plus any
// per-check fields. Field types: 'number', 'text', 'list' (one entry per line).
const CHECKS = [
  { key: 'windowsServerBackup', label: 'Windows Server Backup',
    desc: 'Optional — enable on servers that use Windows Server Backup. Warns if the last successful backup is older than the age below.',
    fields: [{ key: 'maxAgeHours', label: 'Max age (hours)', type: 'number' }] },
  { key: 'sage', label: 'Sage 50 (file backup)',
    desc: 'Enable on servers running Sage 50 Accounts. Backup folders are auto-discovered; warns if Sage is not detected.',
    fields: [{ key: 'staleHours', label: 'Stale after (hours)', type: 'number' }] },
  { key: 'rdpguard', label: 'RDPGuard',
    desc: 'Enable on servers running RDPGuard. Fails if installed but not running; warns if not detected.',
    fields: [] },
  { key: 'irisInvu', label: 'IRIS / INVU',
    desc: 'Enable on servers running IRIS/INVU. Checks IRIS*.bak and IRISDOCS*.zip in the folder below; warns if the INVU service is not detected.',
    fields: [
      { key: 'backupPath', label: 'IRIS backup folder', type: 'text', placeholder: 'e.g. D:\\\\IRIS\\\\Backups' },
      { key: 'staleHours', label: 'Stale after (hours)', type: 'number' },
    ] },
  { key: 'sageSql', label: 'Sage SQL backups',
    desc: 'Enable where Sage SQL backups run. Scans each folder below for the latest .bak/.zip; warns if no folders are set.',
    fields: [
      { key: 'paths', label: 'Backup folders (one per line)', type: 'list' },
      { key: 'staleHours', label: 'Stale after (hours)', type: 'number' },
    ] },
  { key: 'storagecraft', label: 'StorageCraft ShadowProtect SPX',
    desc: 'Enable on servers running ShadowProtect SPX. Reads job results from the SPX logs; warns if SPX is not detected.',
    fields: [{ key: 'staleHours', label: 'Stale after (hours)', type: 'number' }] },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderToggles(checks) {
  const wrap = document.getElementById('checkToggles');
  wrap.innerHTML = '';
  for (const chk of CHECKS) {
    const cfg = checks[chk.key] || {};
    const enabled = cfg.enabled !== false;
    const block = document.createElement('div');
    block.className = 'checkblock' + (enabled ? '' : ' disabled');

    let fieldsHtml = '';
    for (const f of chk.fields) {
      let inputHtml;
      if (f.type === 'list') {
        const arr = Array.isArray(cfg[f.key]) ? cfg[f.key] : [];
        inputHtml = '<textarea id="f_' + chk.key + '_' + f.key + '" style="min-height:60px">' + esc(arr.join('\\n')) + '</textarea>';
      } else if (f.type === 'text') {
        inputHtml = '<input type="text" id="f_' + chk.key + '_' + f.key + '" value="' + esc(cfg[f.key] != null ? cfg[f.key] : '') + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + ' />';
      } else {
        inputHtml = '<input type="number" id="f_' + chk.key + '_' + f.key + '" value="' + esc(cfg[f.key] != null ? cfg[f.key] : '') + '" style="width:120px" />';
      }
      fieldsHtml += '<div><label style="margin:0 0 4px">' + esc(f.label) + '</label>' + inputHtml + '</div>';
    }

    block.innerHTML =
      '<div class="head"><input type="checkbox" id="en_' + chk.key + '"' + (enabled ? ' checked' : '') + ' />' +
      '<span class="name">' + esc(chk.label) + '</span></div>' +
      '<div class="desc">' + esc(chk.desc) + '</div>' +
      (fieldsHtml ? '<div class="fields">' + fieldsHtml + '</div>' : '');
    wrap.appendChild(block);

    // Dim the block when unticked, as a quick visual cue.
    block.querySelector('#en_' + chk.key).addEventListener('change', (e) => {
      block.classList.toggle('disabled', !e.target.checked);
    });
  }
}

async function load() {
  const r = await fetch('/api/config', { headers: H });
  current = await r.json();
  document.getElementById('apiUrl').value = current.apiUrl || '';
  // The real key is never sent to the page. Show a placeholder indicating one
  // is stored; a blank field on save keeps it.
  const keyEl = document.getElementById('apiKey');
  keyEl.value = '';
  keyEl.placeholder = current.apiKeySet ? '•••••••• stored (leave blank to keep)' : 'mml_... (no key set yet)';
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
  renderPings(current.pingTargets || []);
  const upd = current.update || {};
  document.getElementById('updateEnabled').checked = upd.enabled !== false;
  document.getElementById('hostline').textContent = 'Local configuration for ' + (current._hostname || 'this server');
  updateWatchSummary();
}

// Summarise the watched-services list under the "Choose services" button.
function updateWatchSummary() {
  let list = [];
  try { list = JSON.parse(document.getElementById('watchServices').value || '[]'); } catch {}
  const el = document.getElementById('watchSummary');
  if (!list.length) { el.textContent = 'No services watched.'; return; }
  const crit = list.filter((s) => s.critical).length;
  el.textContent = list.length + ' watched (' + crit + ' critical): ' +
    list.map((s) => (s.displayName || s.name) + (s.critical ? '*' : '')).join(', ');
}

function buildConfig() {
  const cfg = JSON.parse(JSON.stringify(current));
  cfg.apiUrl = document.getElementById('apiUrl').value.trim();
  // Only send a key when the technician typed one (rotation). A blank field
  // means keep the stored key, so we omit it entirely.
  const typedKey = document.getElementById('apiKey').value.trim();
  if (typedKey) cfg.apiKey = typedKey;
  else delete cfg.apiKey;
  delete cfg.apiKeySet;
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
  for (const chk of CHECKS) {
    const c = checks[chk.key] && typeof checks[chk.key] === 'object' && !Array.isArray(checks[chk.key]) ? checks[chk.key] : {};
    c.enabled = document.getElementById('en_' + chk.key).checked;
    for (const f of chk.fields) {
      const el = document.getElementById('f_' + chk.key + '_' + f.key);
      if (!el) continue;
      if (f.type === 'list') {
        c[f.key] = el.value.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
      } else if (f.type === 'text') {
        c[f.key] = el.value.trim();
      } else if (el.value !== '') {
        c[f.key] = Number(el.value);
      }
    }
    checks[chk.key] = c;
  }

  // Auto-update toggle (preserve any hour/minute already in the config).
  const upd = cfg.update && typeof cfg.update === 'object' ? cfg.update : {};
  upd.enabled = document.getElementById('updateEnabled').checked;
  cfg.update = upd;

  // LAN ping monitors.
  const pings = [];
  document.querySelectorAll('#pingList .ping-row').forEach(function (row) {
    const name = row.querySelector('.ping-name').value.trim();
    const host = row.querySelector('.ping-host').value.trim();
    if (host) pings.push({ name: name || host, host: host });
  });
  cfg.pingTargets = pings;
  return cfg;
}

// Build one editable ping-target row (name + host + remove).
function makePingRow(name, host) {
  const row = document.createElement('div');
  row.className = 'ping-row';
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px';
  const n = document.createElement('input');
  n.className = 'ping-name';
  n.placeholder = 'Name (e.g. NAS, Switch)';
  n.value = name || '';
  n.style.flex = '1';
  const h = document.createElement('input');
  h.className = 'ping-host';
  h.placeholder = 'IP or hostname';
  h.value = host || '';
  h.style.flex = '1';
  const b = document.createElement('button');
  b.className = 'ghost';
  b.type = 'button';
  b.textContent = '✕';
  b.title = 'Remove';
  b.style.cssText = 'padding:6px 10px';
  b.onclick = function () {
    row.remove();
  };
  row.appendChild(n);
  row.appendChild(h);
  row.appendChild(b);
  return row;
}
function renderPings(list) {
  const el = document.getElementById('pingList');
  el.innerHTML = '';
  (list || []).forEach(function (t) {
    el.appendChild(makePingRow(t.name, t.host));
  });
}
function addPing() {
  document.getElementById('pingList').appendChild(makePingRow('', ''));
}

async function save() {
  let cfg;
  try { cfg = buildConfig(); }
  catch (e) { return toast('Invalid JSON in one of the list fields: ' + e.message, false); }
  if (!cfg.apiUrl) return toast('API URL is required.', false);
  if (!current.apiKeySet && !cfg.apiKey) return toast('API key is required (no key is stored yet).', false);
  let pw;
  try { pw = await getSettingsPassword(); } catch { return; } // cancelled
  const r = await fetch('/api/config', { method: 'POST', headers: pwHeaders(pw), body: JSON.stringify(cfg) });
  const body = await r.json().catch(() => ({}));
  if (r.ok) {
    toast('Settings saved.', true);
    await load();
  } else if (r.status === 403) {
    forgetPassword();
    toast('Settings password incorrect — try saving again.', false);
  } else {
    toast('Save failed: ' + (body.error || r.status), false);
  }
}

// needsAuth: true for endpoints gated by the settings password (send-report,
// run-check). test-connection isn't gated, so it skips the prompt.
async function act(path, msg, needsAuth) {
  let headers = H;
  if (needsAuth) {
    let pw;
    try { pw = await getSettingsPassword(); } catch { return; }
    headers = pwHeaders(pw);
  }
  toast(msg, true);
  const r = await fetch('/api/' + path, { method: 'POST', headers });
  const body = await r.json().catch(() => ({}));
  if (r.ok) toast(body.message || 'Done.', true);
  else if (needsAuth && r.status === 403) { forgetPassword(); toast('Settings password incorrect — try again.', false); }
  else toast('Failed: ' + (body.error || r.status), false);
}

// --- Service picker modal ---
let allServices = [];
function openServices() {
  const m = document.getElementById('svcModal');
  svcSel = {}; // reload selection from the current watch list
  m.classList.add('show');
  document.getElementById('svcSearch').value = '';
  document.getElementById('svcList').textContent = 'Loading services...';
  fetch('/api/services', { headers: H })
    .then((r) => r.json())
    .then((d) => { allServices = d.services || []; renderSvc(); })
    .catch((e) => { document.getElementById('svcList').textContent = 'Could not load services: ' + e.message; });
}
function closeServices() {
  document.getElementById('svcModal').classList.remove('show');
}
function currentWatchMap() {
  let list = [];
  try { list = JSON.parse(document.getElementById('watchServices').value || '[]'); } catch {}
  const map = {};
  for (const s of list) if (s && s.name) map[s.name.toLowerCase()] = { watch: true, critical: !!s.critical };
  return map;
}
// Live selection state keyed by lowercased service name.
let svcSel = {};
function renderSvc() {
  if (Object.keys(svcSel).length === 0) svcSel = currentWatchMap();
  const q = (document.getElementById('svcSearch').value || '').toLowerCase();
  const rows = allServices.filter((s) =>
    !q || s.name.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q)
  );
  const wrap = document.getElementById('svcList');
  wrap.innerHTML = '';
  for (const s of rows) {
    const key = s.name.toLowerCase();
    const sel = svcSel[key] || { watch: false, critical: false };
    const row = document.createElement('div');
    row.className = 'svc-row';
    row.innerHTML =
      '<input type="checkbox" ' + (sel.watch ? 'checked' : '') + ' data-w="' + esc(key) + '" />' +
      '<div><div>' + esc(s.displayName) + '<span class="dot ' + (s.running ? 'on' : 'off') + '"></span></div>' +
      '<div class="sname">' + esc(s.name) + '</div></div>' +
      '<label class="crit"><input type="checkbox" ' + (sel.critical ? 'checked' : '') + ' data-c="' + esc(key) + '" />Critical</label>';
    wrap.appendChild(row);
  }
  // Wire change handlers.
  wrap.querySelectorAll('input[data-w]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const k = e.target.getAttribute('data-w');
      svcSel[k] = svcSel[k] || { watch: false, critical: false };
      svcSel[k].watch = e.target.checked;
    });
  });
  wrap.querySelectorAll('input[data-c]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const k = e.target.getAttribute('data-c');
      svcSel[k] = svcSel[k] || { watch: false, critical: false };
      svcSel[k].critical = e.target.checked;
      if (e.target.checked) svcSel[k].watch = true; // critical implies watched
      renderSvc();
    });
  });
  const picked = Object.values(svcSel).filter((v) => v.watch).length;
  document.getElementById('svcCount').textContent = picked + ' selected';
}
function applyServices() {
  const byName = {};
  for (const s of allServices) byName[s.name.toLowerCase()] = s;
  const list = [];
  for (const [key, v] of Object.entries(svcSel)) {
    if (!v.watch) continue;
    const svc = byName[key];
    list.push({
      name: svc ? svc.name : key,
      displayName: svc ? svc.displayName : key,
      critical: !!v.critical,
    });
  }
  list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  document.getElementById('watchServices').value = JSON.stringify(list, null, 2);
  svcSel = {};
  updateWatchSummary();
  closeServices();
  toast('Watched services updated — remember to Save settings.', true);
}

load().catch(e => toast('Could not load config: ' + e.message, false));
</script>
</body>
</html>`;

module.exports = { PAGE };
