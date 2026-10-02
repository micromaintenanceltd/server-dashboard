'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchServers } from '@/lib/api';
import type { ServerListItem, ServersResponse, ServerStatus } from '@/lib/types';
import { Clock } from '@/components/Clock';
import { relativeAge } from '@/lib/format';

const POLL_MS = 30_000;

export default function KioskPage() {
  const [data, setData] = useState<ServersResponse | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [fs, setFs] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchServers();
      setData(res);
      setLastRefresh(Date.now());
    } catch {
      /* keep showing the last good data on a transient failure */
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [load]);

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const servers = [...(data?.servers ?? [])].sort(sortForWall);
  const status = countStatus(servers);
  const online = servers.filter((s) => s.status === 'online');
  const avgCpu = avg(online.map((s) => s.latest?.cpu_percent).filter(isNum));
  const avgRam = avg(
    online
      .map((s) =>
        s.latest && s.latest.ram_total_mb ? ((s.latest.ram_used_mb ?? 0) / s.latest.ram_total_mb) * 100 : null
      )
      .filter(isNum)
  );
  const checksFail = servers.filter((s) => s.latest_check?.overall_status === 'fail').length;
  const disksOver = servers.filter((s) => (worstDisk(s) ?? 0) >= 90).length;
  const offline = servers.filter((s) => s.status === 'offline');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[2400px] px-6 py-6">
        {/* Header */}
        <header className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="brand-chip h-12 w-12 p-1.5" />
            <div>
              <div className="text-xl font-semibold text-white">Micro Maintenance</div>
              <div className="text-sm text-slate-400">
                {servers.length} devices · refreshed {relativeAge(new Date(lastRefresh).toISOString())}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleFs}
              title={fs ? 'Exit full screen' : 'Full screen'}
              aria-label={fs ? 'Exit full screen' : 'Full screen'}
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {fs ? <MinimizeIcon /> : <MaximizeIcon />}
            </button>
            <Link
              href="/"
              title="Exit kiosk"
              aria-label="Exit kiosk"
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <HomeIcon />
            </Link>
            <Clock size="lg" tone="dark" />
          </div>
        </header>

        {/* Offline banner */}
        {offline.length > 0 && (
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-red-800 bg-red-950/60 px-5 py-3 text-lg">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-status-offline text-sm font-bold text-white">
              !
            </span>
            <span className="font-semibold text-red-200">
              {offline.length} {offline.length === 1 ? 'device' : 'devices'} offline
            </span>
            <span className="truncate text-red-300/80">— {offline.map((s) => s.name).join(', ')}</span>
          </div>
        )}

        {/* KPI strip */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Online" value={status.online} accent="text-status-online" />
          <Kpi label="Offline" value={status.offline} accent={status.offline ? 'text-status-offline' : 'text-slate-300'} />
          <Kpi label="Stale" value={status.stale} accent={status.stale ? 'text-status-stale' : 'text-slate-300'} />
          <Kpi label="Check fails" value={checksFail} accent={checksFail ? 'text-status-offline' : 'text-slate-300'} />
          <Kpi label="Disks ≥90%" value={disksOver} accent={disksOver ? 'text-status-stale' : 'text-slate-300'} />
          <Kpi label="Avg CPU" value={avgCpu != null ? `${Math.round(avgCpu)}%` : '—'} sub={avgRam != null ? `RAM ${Math.round(avgRam)}%` : ''} />
        </div>

        {/* Fleet grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {servers.map((s) => (
            <Cell key={s.id} server={s} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: number | string;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-4xl font-semibold tabular-nums ${accent ?? 'text-white'}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Cell({ server }: { server: ServerListItem }) {
  const cpu = server.latest?.cpu_percent ?? null;
  const ram =
    server.latest && server.latest.ram_total_mb
      ? ((server.latest.ram_used_mb ?? 0) / server.latest.ram_total_mb) * 100
      : null;
  const disk = worstDisk(server);
  const pingDown = (server.latest?.pings ?? []).filter((p) => p.ok === false).length;
  const critStopped = server.latest?.services?.stopped_critical?.length ?? 0;

  const s = server.status;
  const border =
    s === 'offline'
      ? 'border-l-status-offline'
      : s === 'stale'
        ? 'border-l-status-stale'
        : s === 'pending'
          ? 'border-l-slate-600'
          : 'border-l-status-online';
  const bg = s === 'offline' ? 'bg-red-950/50' : 'bg-slate-900';

  return (
    <div className={`rounded-xl border border-slate-800 border-l-4 ${border} ${bg} p-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-white">{server.client_name}</div>
          <div className="truncate text-xs text-slate-400">{server.name}</div>
        </div>
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full bg-status-${s}`} title={s} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 text-center">
        <Stat label="CPU" v={cpu} />
        <Stat label="RAM" v={ram} />
        <Stat label="Disk" v={disk} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
        {critStopped > 0 ? (
          <span className="font-medium text-status-offline">{critStopped} crit stopped</span>
        ) : pingDown > 0 ? (
          <span className="font-medium text-status-offline">{pingDown} LAN down</span>
        ) : server.latest_check ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full bg-status-${checkDot(server.latest_check.overall_status)}`} />
            {server.latest_check.overall_status}
          </span>
        ) : (
          <span className="text-slate-500">no check</span>
        )}
        <span className="ml-auto">{relativeAge(server.last_seen_at)}</span>
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number | null }) {
  const cls =
    v == null ? 'text-slate-500' : v >= 90 ? 'text-status-offline' : v >= 75 ? 'text-status-stale' : 'text-slate-100';
  return (
    <div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{v == null ? '—' : `${Math.round(v)}%`}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function checkDot(s: 'pass' | 'warn' | 'fail'): ServerStatus {
  return s === 'fail' ? 'offline' : s === 'warn' ? 'stale' : 'online';
}

function MaximizeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
function MinimizeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

// Sort worst-first so problems float to the top-left of the wall.
function rank(s: ServerListItem): number {
  if (s.status === 'offline') return 0;
  if ((s.latest?.services?.stopped_critical?.length ?? 0) > 0) return 1;
  if ((s.latest?.pings ?? []).some((p) => p.ok === false)) return 1;
  if (s.status === 'stale') return 2;
  if (s.latest_check?.overall_status === 'fail') return 3;
  if (s.latest_check?.overall_status === 'warn') return 4;
  return 5;
}
function sortForWall(a: ServerListItem, b: ServerListItem): number {
  const d = rank(a) - rank(b);
  if (d !== 0) return d;
  return a.name.localeCompare(b.name);
}

function countStatus(servers: ServerListItem[]): Record<ServerStatus, number> {
  const out: Record<ServerStatus, number> = { online: 0, stale: 0, offline: 0, pending: 0 };
  for (const s of servers) out[s.status]++;
  return out;
}
function worstDisk(s: ServerListItem): number | null {
  const disks = s.latest?.disk ?? [];
  if (!disks.length) return null;
  return 100 - Math.min(...disks.map((d) => d.free_percent));
}
function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function isNum(x: unknown): x is number {
  return typeof x === 'number' && !isNaN(x);
}
