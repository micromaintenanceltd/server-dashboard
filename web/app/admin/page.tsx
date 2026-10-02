'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchServers,
  createServer,
  deleteServer,
  decommissionServer,
  rotateKey,
  saveClientLogo,
  fetchAlertConfig,
  saveAlertConfig,
  testAlert,
  fetchAgentRelease,
  setAgentReleaseEnabled,
  type AlertConfigView,
  type AgentReleaseView,
} from '@/lib/api';
import type { ServerListItem } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { ClientLogo } from '@/components/ClientLogo';
import { useClientLogos } from '@/components/ClientLogosProvider';
import { fileToLogoDataUrl } from '@/lib/image';
import { relativeAge } from '@/lib/format';

export default function AdminPage() {
  const [servers, setServers] = useState<ServerListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The most recently issued raw key (shown once, never retrievable again).
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchServers();
      setServers(res.servers);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="px-8 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500">
          Provision devices, manage their API keys, and set company logos.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Newly issued key callout */}
      {issued && (
        <IssuedKeyCallout name={issued.name} apiKey={issued.key} onClose={() => setIssued(null)} />
      )}

      {/* Add server */}
      <AddServerForm
        onCreated={(name, key) => {
          setIssued({ name, key });
          load();
        }}
        onError={setError}
      />

      {/* Devices table */}
      <section className="card overflow-hidden">
        <div className="panel-header border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          Devices ({servers.length})
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading...</p>
        ) : servers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No devices yet. Add one above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => (
                <ServerRow
                  key={s.id}
                  server={s}
                  onRotated={(name, key) => {
                    setIssued({ name, key });
                    load();
                  }}
                  onDeleted={load}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Company logos */}
      <LogosSection servers={servers} onError={setError} />

      {/* Alerts */}
      <AlertsSection onError={setError} />

      {/* Agent auto-update */}
      <AgentUpdateSection onError={setError} />
    </div>
  );
}

function AgentUpdateSection({ onError }: { onError: (m: string) => void }) {
  const [rel, setRel] = useState<AgentReleaseView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetchAgentRelease();
      setRel(r);
    } catch (err: any) {
      onError(err.message || 'Failed to load agent release');
    } finally {
      setLoaded(true);
    }
  }, [onError]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function setEnabled(enabled: boolean) {
    if (
      enabled &&
      !confirm(
        `Approve agent v${rel?.version} for rollout?\n\n` +
          `Every device with automatic updates on will download, verify and install it ` +
          `at its next daily check. You can disable this again at any time (kill switch).`
      )
    )
      return;
    setBusy(true);
    onError('');
    try {
      await setAgentReleaseEnabled(enabled);
      await reload();
    } catch (err: any) {
      onError(err.message || 'Failed to update rollout');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="panel-header border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        Agent updates
      </div>
      <div className="space-y-4 p-4">
        {!rel || !rel.version ? (
          <p className="text-sm text-slate-500">
            No agent version has been published yet. Publish one from the build machine
            (<code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">build.ps1 -Publish</code>) and
            it will appear here for approval.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <div className="font-semibold text-slate-800">
                  Latest published: v{rel.version}
                </div>
                <div className="text-xs text-slate-500">
                  Updated {rel.updated_at ? relativeAge(rel.updated_at) : 'recently'} · SHA-256{' '}
                  <span className="font-mono">{(rel.sha256 || '').slice(0, 12)}…</span>
                </div>
              </div>
              <span
                className={
                  'rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                  (rel.enabled
                    ? 'border border-emerald-200 bg-emerald-100 text-emerald-800'
                    : 'border border-amber-200 bg-amber-100 text-amber-800')
                }
              >
                {rel.enabled ? 'Approved — rolling out' : 'Pending approval'}
              </span>
            </div>

            <p className="text-xs text-slate-500">
              When approved, devices with automatic updates enabled check daily, verify the
              SHA-256, and install this version. Pin an individual device from its local settings
              page (untick “Automatic updates”).
            </p>

            <div className="flex flex-wrap items-center gap-3">
              {rel.enabled ? (
                <button
                  className="rounded-md border border-red-200 px-3.5 py-2 text-sm font-medium text-status-offline hover:bg-red-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => setEnabled(false)}
                >
                  {busy ? 'Working…' : 'Disable rollout (kill switch)'}
                </button>
              ) : (
                <button className="btn-primary" disabled={busy} onClick={() => setEnabled(true)}>
                  {busy ? 'Working…' : `Approve v${rel.version} for rollout`}
                </button>
              )}
              {rel.downloadUrl && (
                <a
                  className="text-xs font-medium text-brand-700 hover:underline"
                  href={rel.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download installer
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function AlertsSection({ onError }: { onError: (m: string) => void }) {
  const [cfg, setCfg] = useState<AlertConfigView | null>(null);
  const [teams, setTeams] = useState('');
  const [emailKey, setEmailKey] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [fdKey, setFdKey] = useState('');
  const [fdDomain, setFdDomain] = useState('');
  const [fdEmail, setFdEmail] = useState('');
  const [fdGroup, setFdGroup] = useState('');
  const [onCheck, setOnCheck] = useState(true);
  const [onOffline, setOnOffline] = useState(true);
  const [onCrit, setOnCrit] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const c = await fetchAlertConfig();
      setCfg(c);
      setEmailTo(c.email_to);
      setEmailFrom(c.email_from);
      setFdDomain(c.freshdesk_domain);
      setFdEmail(c.freshdesk_email);
      setFdGroup(c.freshdesk_group_id);
      setOnCheck(c.on_check_fail);
      setOnOffline(c.on_offline);
      setOnCrit(c.on_crit_stopped);
      setTeams('');
      setEmailKey('');
      setFdKey('');
    } catch (err: any) {
      onError(err.message || 'Failed to load alert settings');
    }
  }, [onError]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function save() {
    setBusy(true);
    setStatus(null);
    onError('');
    try {
      const body: Record<string, unknown> = {
        email_to: emailTo,
        email_from: emailFrom,
        freshdesk_domain: fdDomain,
        freshdesk_email: fdEmail,
        freshdesk_group_id: fdGroup,
        on_check_fail: onCheck,
        on_offline: onOffline,
        on_crit_stopped: onCrit,
      };
      if (teams.trim()) body.teams_webhook_url = teams.trim();
      if (emailKey.trim()) body.email_api_key = emailKey.trim();
      if (fdKey.trim()) body.freshdesk_api_key = fdKey.trim();
      await saveAlertConfig(body);
      await reload();
      setStatus('Saved.');
    } catch (err: any) {
      onError(err.message || 'Failed to save alert settings');
    } finally {
      setBusy(false);
    }
  }

  async function clearSecret(which: 'teams' | 'email' | 'freshdesk') {
    setBusy(true);
    onError('');
    try {
      const payload =
        which === 'teams'
          ? { clear_teams: true }
          : which === 'email'
            ? { clear_email_key: true }
            : { clear_freshdesk_key: true };
      await saveAlertConfig(payload);
      await reload();
    } catch (err: any) {
      onError(err.message || 'Failed to update');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus(null);
    onError('');
    try {
      const r = await testAlert();
      const parts: string[] = [];
      if (r.teams != null) parts.push(`Teams ${r.teams ? 'sent ✓' : 'failed ✗'}`);
      if (r.email != null) parts.push(`Email ${r.email ? 'sent ✓' : 'failed ✗'}`);
      if (r.freshdesk != null)
        parts.push(
          r.freshdesk
            ? `Freshdesk ticket #${r.freshdesk_ticket} created ✓`
            : 'Freshdesk failed ✗'
        );
      setStatus((parts.join(' · ') || 'Nothing configured') + (r.errors.length ? ` — ${r.errors.join('; ')}` : ''));
    } catch (err: any) {
      onError(err.message || 'Test failed');
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return null;

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="panel-header border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        Alerts
      </div>
      <div className="space-y-5 p-4">
        {/* Teams */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Microsoft Teams Incoming Webhook URL
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              autoComplete="off"
              value={teams}
              onChange={(e) => setTeams(e.target.value)}
              placeholder={cfg.teams_set ? '•••••••• set (leave blank to keep)' : 'https://…webhook.office.com/…'}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            {cfg.teams_set && (
              <button className="btn-ghost whitespace-nowrap px-3 py-2" disabled={busy} onClick={() => clearSecret('teams')}>
                Remove
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            In Teams: channel ••• → Workflows → “Post to a channel when a webhook request is
            received” → create → copy the generated URL here. (The old “Connectors” option has been
            retired by Microsoft.)
          </p>
        </div>

        {/* Email */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Alert emails to (comma separated)</label>
            <input
              type="text"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="alerts@micromaintenance.co.uk"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">From address (verified in Resend)</label>
            <input
              type="text"
              value={emailFrom}
              onChange={(e) => setEmailFrom(e.target.value)}
              placeholder="dashboard@micromaintenance.co.uk"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Resend API key</label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                value={emailKey}
                onChange={(e) => setEmailKey(e.target.value)}
                placeholder={cfg.email_key_set ? '•••••••• set (leave blank to keep)' : 're_…'}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              {cfg.email_key_set && (
                <button className="btn-ghost whitespace-nowrap px-3 py-2" disabled={busy} onClick={() => clearSecret('email')}>
                  Remove
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Email stays off until all three email fields are set. Teams works on its own.
            </p>
          </div>
        </div>

        {/* Freshdesk */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 text-xs font-medium text-slate-600">
            Freshdesk (raise a ticket on failure, auto-resolve on recovery)
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Freshdesk domain</label>
            <input
              type="text"
              value={fdDomain}
              onChange={(e) => setFdDomain(e.target.value)}
              placeholder="micromaintenance (→ micromaintenance.freshdesk.com)"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Requester email (ticket raised under)</label>
            <input
              type="text"
              value={fdEmail}
              onChange={(e) => setFdEmail(e.target.value)}
              placeholder="alerts@micromaintenance.co.uk"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Group ID (optional)</label>
            <input
              type="text"
              value={fdGroup}
              onChange={(e) => setFdGroup(e.target.value)}
              placeholder="e.g. 205000066002"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Freshdesk API key</label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                value={fdKey}
                onChange={(e) => setFdKey(e.target.value)}
                placeholder={cfg.freshdesk_key_set ? '•••••••• set (leave blank to keep)' : 'API key'}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              {cfg.freshdesk_key_set && (
                <button className="btn-ghost whitespace-nowrap px-3 py-2" disabled={busy} onClick={() => clearSecret('freshdesk')}>
                  Remove
                </button>
              )}
            </div>
          </div>
          <p className="sm:col-span-2 text-xs text-slate-500">
            Freshdesk stays off until domain, requester email and API key are all set. Use a current
            API key — the one from the old script was flagged for rotation.
          </p>
        </div>

        {/* Triggers */}
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Alert me when…</div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={onCheck} onChange={(e) => setOnCheck(e.target.checked)} />
              a weekly check fails
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={onOffline} onChange={(e) => setOnOffline(e.target.checked)} />
              a device goes offline
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={onCrit} onChange={(e) => setOnCrit(e.target.checked)} />
              a critical service stops
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save alert settings'}
          </button>
          <button className="btn-ghost px-3.5 py-2" disabled={busy} onClick={test}>
            Send test alert
          </button>
          {status && <span className="text-sm text-slate-600">{status}</span>}
        </div>
      </div>
    </section>
  );
}

function LogosSection({
  servers,
  onError,
}: {
  servers: ServerListItem[];
  onError: (m: string) => void;
}) {
  const { logos, refresh } = useClientLogos();
  const [busy, setBusy] = useState<string | null>(null);
  const clients = Array.from(new Set(servers.map((s) => s.client_name).filter(Boolean))).sort();

  if (clients.length === 0) return null;

  async function upload(client: string, file: File) {
    setBusy(client);
    onError('');
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      await saveClientLogo(client, dataUrl);
      await refresh();
    } catch (err: any) {
      onError(err.message || 'Logo upload failed.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(client: string) {
    setBusy(client);
    onError('');
    try {
      await saveClientLogo(client, null);
      await refresh();
    } catch (err: any) {
      onError(err.message || 'Could not remove the logo.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="panel-header border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        Company logos
      </div>
      <p className="px-4 pt-3 text-xs text-slate-500">
        A logo appears next to every device belonging to that company. Images are resized small
        automatically.
      </p>
      <ul className="divide-y divide-slate-100">
        {clients.map((c) => (
          <LogoRow
            key={c}
            client={c}
            hasLogo={!!logos[c]}
            busy={busy === c}
            onUpload={(f) => upload(c, f)}
            onRemove={() => remove(c)}
          />
        ))}
      </ul>
    </section>
  );
}

function LogoRow({
  client,
  hasLogo,
  busy,
  onUpload,
  onRemove,
}: {
  client: string;
  hasLogo: boolean;
  busy: boolean;
  onUpload: (f: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <ClientLogo client={client} size={40} />
      <div className="min-w-0 flex-1 truncate font-medium text-slate-800">{client}</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = '';
        }}
      />
      <button className="btn-ghost px-3 py-1.5" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Saving…' : hasLogo ? 'Replace' : 'Upload'}
      </button>
      {hasLogo && (
        <button
          className="text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-50"
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
      )}
    </li>
  );
}

function AddServerForm({
  onCreated,
  onError,
}: {
  onCreated: (name: string, key: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !client.trim()) {
      onError('Name and client are required.');
      return;
    }
    setBusy(true);
    try {
      const res = await createServer({
        name: name.trim(),
        client_name: client.trim(),
        location: location.trim() || undefined,
      });
      onCreated(res.server.name, res.api_key);
      setName('');
      setClient('');
      setLocation('');
    } catch (err: any) {
      onError(err.message || 'Failed to create device');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-6 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add device</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Device name" value={name} onChange={setName} placeholder="DC01" />
        <Field label="Client" value={client} onChange={setClient} placeholder="Acme Ltd" />
        <Field
          label="Location (optional)"
          value={location}
          onChange={setLocation}
          placeholder="Leeds HQ"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Creating...' : 'Create + generate key'}
        </button>
      </form>
    </section>
  );
}

function ServerRow({
  server,
  onRotated,
  onDeleted,
  onError,
}: {
  server: ServerListItem;
  onRotated: (name: string, key: string) => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function doRotate() {
    if (!confirm(`Rotate the key for ${server.name}? The old key stops working immediately.`)) return;
    setBusy(true);
    try {
      const res = await rotateKey(server.id);
      onRotated(server.name, res.api_key);
    } catch (err: any) {
      onError(err.message || 'Failed to rotate key');
    } finally {
      setBusy(false);
    }
  }

  async function doDecommission() {
    if (
      !confirm(
        `Decommission ${server.name}? The agent will uninstall itself on its next check-in ` +
          `(within a few minutes), then the record is removed.`
      )
    )
      return;
    setBusy(true);
    try {
      await decommissionServer(server.id);
      onDeleted();
    } catch (err: any) {
      onError(err.message || 'Failed to decommission device');
    } finally {
      setBusy(false);
    }
  }

  async function doForceRemove() {
    if (
      !confirm(
        `Force-remove ${server.name} now? This deletes the record and all history immediately. ` +
          `Use this only if the device is already gone; any agent still installed will not be uninstalled.`
      )
    )
      return;
    setBusy(true);
    try {
      await deleteServer(server.id);
      onDeleted();
    } catch (err: any) {
      onError(err.message || 'Failed to remove device');
    } finally {
      setBusy(false);
    }
  }

  const decommissioning = server.desired_state === 'decommission';

  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-4 py-2 font-medium text-slate-800">{server.name}</td>
      <td className="px-4 py-2 text-slate-600">
        {server.client_name}
        {server.location ? <span className="text-slate-400"> · {server.location}</span> : null}
      </td>
      <td className="px-4 py-2">
        {decommissioning ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Decommissioning
          </span>
        ) : (
          <StatusBadge status={server.status} />
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-slate-500">
        {server.api_key_prefix ? `${server.api_key_prefix}...` : 'n/a'}
      </td>
      <td className="px-4 py-2 text-slate-500">{relativeAge(server.last_seen_at)}</td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-2">
          <button
            onClick={doRotate}
            disabled={busy}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Rotate key
          </button>
          <button
            onClick={doDecommission}
            disabled={busy || decommissioning}
            title="Tell the agent to uninstall itself, then remove the record"
            className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          >
            {decommissioning ? 'Pending...' : 'Decommission'}
          </button>
          <button
            onClick={doForceRemove}
            disabled={busy}
            title="Remove the record immediately without uninstalling the agent"
            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-status-offline hover:bg-red-50 disabled:opacity-50"
          >
            Force remove
          </button>
        </div>
      </td>
    </tr>
  );
}

function IssuedKeyCallout({
  name,
  apiKey,
  onClose,
}: {
  name: string;
  apiKey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; the key is visible to copy manually.
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-900">API key for {name}</h2>
          <p className="mt-0.5 text-xs text-amber-800">
            Copy this now. It is shown once and cannot be retrieved later. Paste it into that
            device&apos;s agent config.json as the apiKey.
          </p>
        </div>
        <button onClick={onClose} className="text-xs font-medium text-amber-800 hover:underline">
          Dismiss
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-800">
          {apiKey}
        </code>
        <button
          onClick={copy}
          className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-44 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
    </label>
  );
}
