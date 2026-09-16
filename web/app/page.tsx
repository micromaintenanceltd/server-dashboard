'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchServers } from '@/lib/api';
import type { ServerListItem, ServersResponse, ServerStatus } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { UsageBar } from '@/components/UsageBar';
import { relativeAge, formatMb, CHECK_META } from '@/lib/format';

const POLL_MS = 30_000;

export default function DashboardPage() {
  const [data, setData] = useState<ServersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

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
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </div>
      )}
    </div>
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
