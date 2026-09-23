'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchServers } from '@/lib/api';
import type { ServerListItem, ServersResponse, ServerStatus } from '@/lib/types';
import { StatusBadge, StatusDot } from '@/components/StatusBadge';
import { UsageBar } from '@/components/UsageBar';
import { relativeAge, formatMb, CHECK_META } from '@/lib/format';

const POLL_MS = 30_000;

type ViewMode = 'tile' | 'list';
const VIEW_STORAGE_KEY = 'mml_server_view';

export default function DashboardPage() {
  const [data, setData] = useState<ServersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [view, setView] = useState<ViewMode>('tile');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore the saved view preference (per browser). Runs after mount to avoid
  // a hydration mismatch with the static export.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'tile' || saved === 'list') setView(saved);
    } catch {}
  }, []);

  const changeView = useCallback((v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchServers();
      setData(res);
      setError(null);
      setLastRefresh(Date.now());
    } catch (err: any) {
      setError(err.message || 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const servers = data?.servers ?? [];
  const counts = countByStatus(servers);

  return (
    <div className="px-8 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Servers</h1>
          <p className="text-sm text-slate-500">
            {servers.length} monitored · auto refresh every {POLL_MS / 1000}s · last updated{' '}
            {relativeAge(new Date(lastRefresh).toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <StatusCounts counts={counts} />
          <ViewToggle view={view} onChange={changeView} />
          <button
            onClick={load}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading servers...</p>
      ) : servers.length === 0 ? (
        <EmptyState />
      ) : view === 'tile' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </div>
      ) : (
        <ServerTable servers={servers} />
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const base = 'flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium transition-colors';
  const active = 'bg-white text-slate-900 shadow-sm';
  const inactive = 'text-slate-500 hover:text-slate-700';
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5" role="group" aria-label="View mode">
      <button
        type="button"
        onClick={() => onChange('tile')}
        aria-pressed={view === 'tile'}
        className={`${base} rounded ${view === 'tile' ? active : inactive}`}
        title="Tile view"
      >
        <TileIcon />
        <span className="hidden sm:inline">Tiles</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        aria-pressed={view === 'list'}
        className={`${base} rounded ${view === 'list' ? active : inactive}`}
        title="List view"
      >
        <ListIcon />
        <span className="hidden sm:inline">List</span>
      </button>
    </div>
  );
}

function ServerTable({ servers }: { servers: ServerListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5">Server</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">CPU</th>
            <th className="px-4 py-2.5">RAM</th>
            <th className="px-4 py-2.5">Disk</th>
            <th className="px-4 py-2.5">Weekly check</th>
            <th className="px-4 py-2.5">Last seen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {servers.map((s) => (
            <ServerRow key={s.id} server={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServerRow({ server }: { server: ServerListItem }) {
  const router = useRouter();
  const href = `/server/?id=${encodeURIComponent(server.id)}`;
  const latest = server.latest;
  const ramPercent =
    latest && latest.ram_total_mb ? ((latest.ram_used_mb ?? 0) / latest.ram_total_mb) * 100 : null;
  const worstDisk = worstDiskUsedPercent(latest?.disk ?? []);
  const stoppedCritical = latest?.services?.stopped_critical ?? [];

  return (
    <tr
      onClick={() => router.push(href)}
      className="cursor-pointer hover:bg-slate-50"
    >
      <td className="px-4 py-3 align-middle">
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-slate-900 hover:text-blue-600"
        >
          {server.name}
        </Link>
        <div className="truncate text-xs text-slate-500">
          {server.client_name}
          {server.location ? ` · ${server.location}` : ''}
        </div>
        {stoppedCritical.length > 0 && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-status-offline">
            <WarnIcon />
            {stoppedCritical.length} critical stopped
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        {server.desired_state === 'decommission' ? (
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Decommissioning
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <StatusDot status={server.status} />
            <span className="text-slate-600">{cap(server.status)}</span>
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        <MetricText percent={latest?.cpu_percent ?? null} />
      </td>
      <td className="px-4 py-3 align-middle">
        <MetricText
          percent={ramPercent}
          sublabel={
            latest && latest.ram_total_mb
              ? `${formatMb(latest.ram_used_mb)} / ${formatMb(latest.ram_total_mb)}`
              : undefined
          }
        />
      </td>
      <td className="px-4 py-3 align-middle">
        <MetricText
          percent={worstDisk?.percent ?? null}
          sublabel={worstDisk ? worstDisk.mount : undefined}
        />
      </td>
      <td className="px-4 py-3 align-middle">
        {server.latest_check ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className={`h-2 w-2 rounded-full ${CHECK_META[server.latest_check.overall_status].dot}`} />
            <span className="text-slate-600">
              {CHECK_META[server.latest_check.overall_status].label}
              {server.latest_check.fail_count + server.latest_check.warn_count > 0
                ? ` (${server.latest_check.fail_count}f ${server.latest_check.warn_count}w)`
                : ''}
            </span>
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 align-middle text-slate-500">
        {relativeAge(server.last_seen_at)}
      </td>
    </tr>
  );
}

// Compact metric cell for the list view: a percentage coloured by severity,
// with an optional small sublabel underneath.
function MetricText({ percent, sublabel }: { percent: number | null; sublabel?: string }) {
  if (percent == null) return <span className="text-slate-400">n/a</span>;
  const rounded = Math.round(percent);
  const color = rounded >= 90 ? 'text-status-offline' : rounded >= 75 ? 'text-status-stale' : 'text-slate-700';
  return (
    <div className="whitespace-nowrap">
      <span className={`font-medium tabular-nums ${color}`}>{rounded}%</span>
      {sublabel && <div className="text-xs text-slate-400">{sublabel}</div>}
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function TileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function ServerCard({ server }: { server: ServerListItem }) {
  const latest = server.latest;
  const ramPercent =
    latest && latest.ram_total_mb
      ? ((latest.ram_used_mb ?? 0) / latest.ram_total_mb) * 100
      : null;
  const stoppedCritical = latest?.services?.stopped_critical ?? [];
  const worstDisk = worstDiskUsedPercent(latest?.disk ?? []);

  return (
    <Link
      href={`/server/?id=${encodeURIComponent(server.id)}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-900">{server.name}</div>
          <div className="truncate text-sm text-slate-500">
            {server.client_name}
            {server.location ? ` · ${server.location}` : ''}
          </div>
        </div>
        {server.desired_state === 'decommission' ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Decommissioning
          </span>
        ) : (
          <StatusBadge status={server.status} />
        )}
      </div>

      <div className="mt-4 space-y-3">
        <UsageBar
          percent={latest?.cpu_percent ?? null}
          label="CPU"
          sublabel={latest?.cpu_percent != null ? `${latest.cpu_percent}%` : 'n/a'}
        />
        <UsageBar
          percent={ramPercent}
          label="RAM"
          sublabel={
            latest && latest.ram_total_mb
              ? `${formatMb(latest.ram_used_mb)} / ${formatMb(latest.ram_total_mb)}`
              : 'n/a'
          }
        />
        <UsageBar
          percent={worstDisk?.percent ?? null}
          label={worstDisk ? `Disk ${worstDisk.mount}` : 'Disk'}
          sublabel={worstDisk ? `${worstDisk.percent}% used` : 'n/a'}
        />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <span>Last seen {relativeAge(server.last_seen_at)}</span>
        {stoppedCritical.length > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-status-offline">
            <WarnIcon />
            {stoppedCritical.length} critical stopped
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
        {server.latest_check ? (
          <>
            <span className={`h-2 w-2 rounded-full ${CHECK_META[server.latest_check.overall_status].dot}`} />
            <span>
              Weekly check: {CHECK_META[server.latest_check.overall_status].label}
              {server.latest_check.fail_count + server.latest_check.warn_count > 0
                ? ` (${server.latest_check.fail_count} fail, ${server.latest_check.warn_count} warn)`
                : ''}
            </span>
            <span className="ml-auto">{relativeAge(server.latest_check.run_at)}</span>
          </>
        ) : (
          <span className="text-slate-400">No weekly check yet</span>
        )}
      </div>
    </Link>
  );
}

function StatusCounts({ counts }: { counts: Record<ServerStatus, number> }) {
  const items: { status: ServerStatus; label: string }[] = [
    { status: 'online', label: 'Online' },
    { status: 'stale', label: 'Stale' },
    { status: 'offline', label: 'Offline' },
    { status: 'pending', label: 'Pending' },
  ];
  return (
    <div className="flex items-center gap-3 text-sm">
      {items.map(
        (i) =>
          counts[i.status] > 0 && (
            <span key={i.status} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full bg-status-${i.status}`} />
              <span className="tabular-nums text-slate-600">{counts[i.status]}</span>
            </span>
          )
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-slate-600">No servers yet.</p>
      <p className="mt-1 text-sm text-slate-500">
        Add your first server on the{' '}
        <Link href="/admin/" className="font-medium text-blue-600 hover:underline">
          Admin page
        </Link>{' '}
        to generate its API key.
      </p>
    </div>
  );
}

function countByStatus(servers: ServerListItem[]): Record<ServerStatus, number> {
  const c: Record<ServerStatus, number> = { online: 0, stale: 0, offline: 0, pending: 0 };
  for (const s of servers) c[s.status]++;
  return c;
}

function worstDiskUsedPercent(disks: { mount: string; free_percent: number }[]) {
  if (!disks.length) return null;
  let worst = disks[0];
  for (const d of disks) if (d.free_percent < worst.free_percent) worst = d;
  return { mount: worst.mount, percent: Math.round(100 - worst.free_percent) };
}

function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}
