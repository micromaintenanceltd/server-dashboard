'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchServers } from '@/lib/api';
import type { ServerListItem, ServersResponse, ServerStatus } from '@/lib/types';
import { Clock } from '@/components/Clock';
import { relativeAge } from '@/lib/format';

const POLL_MS = 30_000;
const THEME_KEY = 'mml_kiosk_theme';

export default function KioskPage() {
  const router = useRouter();
  const [data, setData] = useState<ServersResponse | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [fs, setFs] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
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
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {}
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
  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {}
      return next;
    });
  };
  const exitKiosk = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    router.push('/');
  };

  const dark = theme === 'dark';
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

  const btn = dark
    ? 'text-slate-500 hover:bg-slate-800 hover:text-white'
    : 'text-slate-400 hover:bg-slate-200 hover:text-slate-900';

  return (
    <div className={`min-h-screen ${dark ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'}`}>
      <div className="mx-auto max-w-[2400px] px-6 py-6">
        {/* Header */}
        <header className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="brand-chip h-12 w-12 p-1.5" />
            <div>
              <div className={`text-xl font-semibold ${dark ? 'text-white' : 'text-slate-900'}`}>
                Micro Maintenance
              </div>
              <div className={`text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                {servers.length} devices · refreshed {relativeAge(new Date(lastRefresh).toISOString())}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={toggleTheme} title="Toggle light / dark" aria-label="Toggle light / dark" className={`rounded-md p-2 transition-colors ${btn}`}>
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            <button onClick={toggleFs} title={fs ? 'Exit full screen' : 'Full screen'} aria-label={fs ? 'Exit full screen' : 'Full screen'} className={`rounded-md p-2 transition-colors ${btn}`}>
              {fs ? <MinimizeIcon /> : <MaximizeIcon />}
            </button>
            <button onClick={exitKiosk} title="Exit kiosk" aria-label="Exit kiosk" className={`rounded-md p-2 transition-colors ${btn}`}>
              <HomeIcon />
            </button>
            <Clock size="lg" tone={theme} />
          </div>
        </header>

        {/* Offline banner */}
        {offline.length > 0 && (
          <div
            className={`mb-5 flex items-center gap-3 rounded-xl border px-5 py-3 text-lg ${
              dark ? 'border-red-800 bg-red-950/60' : 'border-red-200 bg-red-50'
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-status-offline text-sm font-bold text-white">
              !
            </span>
            <span className={`font-semibold ${dark ? 'text-red-200' : 'text-red-800'}`}>
              {offline.length} {offline.length === 1 ? 'device' : 'devices'} offline
            </span>
            <span className={`truncate ${dark ? 'text-red-300/80' : 'text-red-600'}`}>
              — {offline.map((s) => s.name).join(', ')}
            </span>
          </div>
        )}

        {/* KPI strip */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi dark={dark} label="Online" value={status.online} accent="text-status-online" />
          <Kpi dark={dark} label="Offline" value={status.offline} accent={status.offline ? 'text-status-offline' : undefined} />
          <Kpi dark={dark} label="Stale" value={status.stale} accent={status.stale ? 'text-status-stale' : undefined} />
          <Kpi dark={dark} label="Check fails" value={checksFail} accent={checksFail ? 'text-status-offline' : undefined} />
          <Kpi dark={dark} label="Disks ≥90%" value={disksOver} accent={disksOver ? 'text-status-stale' : undefined} />
          <Kpi dark={dark} label="Avg CPU" value={avgCpu != null ? `${Math.round(avgCpu)}%` : '—'} sub={avgRam != null ? `RAM ${Math.round(avgRam)}%` : ''} />
        </div>

        {/* Fleet grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {servers.map((s) => (
            <Cell key={s.id} server={s} dark={dark} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  dark,
  label,
  value,
  accent,
  sub,
}: {
  dark: boolean;
  label: string;
  value: number | string;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${dark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
      <div className={`text-xs font-medium uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        {label}
      </div>
      <div className={`mt-1 text-4xl font-semibold tabular-nums ${accent ?? (dark ? 'text-white' : 'text-slate-900')}`}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Cell({ server, dark }: { server: ServerListItem; dark: boolean }) {
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
          ? dark
            ? 'border-l-slate-600'
            : 'border-l-slate-300'
          : 'border-l-status-online';
  const base = dark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white';
  const bg = s === 'offline' ? (dark ? 'bg-red-950/50' : 'bg-red-50') : '';

  return (
    <div className={`rounded-xl border border-l-4 ${border} ${base} ${bg} p-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`truncate text-base font-semibold ${dark ? 'text-white' : 'text-slate-900'}`}>
            {server.client_name}
          </div>
          <div className={`truncate text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{server.name}</div>
        </div>
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full bg-status-${s}`} title={s} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 text-center">
        <Stat dark={dark} label="CPU" v={cpu} />
        <Stat dark={dark} label="RAM" v={ram} />
        <Stat dark={dark} label="Disk" v={disk} />
      </div>
      <div className={`mt-2 flex items-center gap-2 text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
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
          <span className={dark ? 'text-slate-500' : 'text-slate-400'}>no check</span>
        )}
        <span className="ml-auto">{relativeAge(server.last_seen_at)}</span>
      </div>
    </div>
  );
}

function Stat({ dark, label, v }: { dark: boolean; label: string; v: number | null }) {
  const cls =
    v == null
      ? 'text-slate-500'
      : v >= 90
        ? 'text-status-offline'
        : v >= 75
          ? 'text-status-stale'
          : dark
            ? 'text-slate-100'
            : 'text-slate-700';
  return (
    <div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{v == null ? '—' : `${Math.round(v)}%`}</div>
      <div className={`text-[10px] uppercase tracking-wide ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
        {label}
      </div>
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
function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
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
