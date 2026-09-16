'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchServers,
  createServer,
  deleteServer,
  decommissionServer,
  rotateKey,
} from '@/lib/api';
import type { ServerListItem } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
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
      setError(err.message || 'Failed to load servers');
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
        <h1 className="text-2xl font-semibold text-slate-900">Servers admin</h1>
        <p className="text-sm text-slate-500">Provision servers and manage their API keys.</p>
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

      {/* Servers table */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          Servers ({servers.length})
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading...</p>
        ) : servers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No servers yet. Add one above.</p>
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
    </div>
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
      onError(err.message || 'Failed to create server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add server</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Server name" value={name} onChange={setName} placeholder="DC01" />
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
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
      onError(err.message || 'Failed to decommission server');
    } finally {
      setBusy(false);
    }
  }

  async function doForceRemove() {
    if (
      !confirm(
        `Force-remove ${server.name} now? This deletes the record and all history immediately. ` +
          `Use this only if the server is already gone; any agent still installed will not be uninstalled.`
      )
    )
      return;
    setBusy(true);
    try {
      await deleteServer(server.id);
      onDeleted();
    } catch (err: any) {
      onError(err.message || 'Failed to remove server');
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
            server&apos;s agent config.json as the apiKey.
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
