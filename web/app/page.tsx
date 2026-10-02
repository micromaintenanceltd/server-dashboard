'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchServers } from '@/lib/api';
import type { ServerListItem, ServersResponse, ServerStatus, CheckStatus } from '@/lib/types';
import { StatusDot } from '@/components/StatusBadge';
import { ClientLogo } from '@/components/ClientLogo';
import { Clock } from '@/components/Clock';
import { relativeAge, CHECK_META } from '@/lib/format';

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
      setError(err.message || 'Failed to load dashboard');
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
  const status = countBy(servers, (s) => s.status) as Record<ServerStatus, number>;
  const checks = countChecks(servers);
  const clients = new Set(servers.map((s) => s.client_name)).size;
  const attention = servers.filter(needsAttention);

  // Fleet-wide aggregates for the wallboard.
  const online = servers.filter((s) => s.status === 'online');
  const avgCpu = avg(online.map((s) => s.latest?.cpu_percent).filter(isNum));
  const avgRam = avg(
    online
      .map((s) => (s.latest && s.latest.ram_total_mb ? ((s.latest.ram_used_mb ?? 0) / s.latest.ram_total_mb) * 100 : null))
      .filter(isNum)
  );
  const disksOver = servers.filter((s) => worstDiskUsed(s) != null && (worstDiskUsed(s) as number) >= 90).length;
  const critStopped = servers.reduce((a, s) => a + (s.latest?.services?.stopped_critical?.length ?? 0), 0);

  return (
    <div className="px-8 py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Overview · auto refresh every {POLL_MS / 1000}s · last updated{' '}
            {relativeAge(new Date(lastRefresh).toISOString())}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={load} className="btn-ghost px-3 py-1.5">
              Refresh
            </button>
            <Link href="/kiosk" className="btn-ghost px-3 py-1.5">
              TV / Kiosk
            </Link>
          </div>
        </div>
        <Clock size="lg" />
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          {/* Unmissable banner whenever any device is offline. */}
          {(status.offline ?? 0) > 0 && (
            <Link
              href="/devices/?status=offline"
              className="mb-4 flex items-start gap-3 rounded-lg border-l-4 border-status-offline bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200 transition-colors hover:bg-red-100"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-offline text-xs font-bold text-white">
                !
              </span>
              <div>
                <span className="font-semibold">
                  {status.offline} {status.offline === 1 ? 'device is' : 'devices are'} offline
                </span>
                <span className="text-red-700">
                  {' — '}
                  {servers
                    .filter((s) => s.status === 'offline')
                    .map((s) => s.name)
                    .join(', ')}
                </span>
              </div>
            </Link>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              label="Devices"
              value={servers.length}
              href="/devices/"
              footer={<span className="text-xs text-slate-500">{clients} clients</span>}
            />
            <KpiCard
              label="Online"
              value={status.online ?? 0}
              accent="text-status-online"
              href="/devices/?status=online"
              footer={<span className="text-xs text-slate-500">of {servers.length} devices</span>}
            />
            <KpiCard
              label="Offline"
              value={status.offline ?? 0}
              accent={status.offline ? 'text-status-offline' : 'text-slate-900'}
              href="/devices/?status=offline"
              footer={
                <span className="text-xs text-slate-500">
                  {status.stale ?? 0} stale · {status.pending ?? 0} pending
                </span>
              }
            />
            <KpiCard
              label="Check failures"
              value={checks.fail}
              accent={checks.fail ? 'text-status-offline' : 'text-status-online'}
              href="/devices/?check=fail"
              footer={<span className="text-xs text-slate-500">{checks.warn} warnings</span>}
            />
            <KpiCard
              label="Disks ≥ 90%"
              value={disksOver}
              accent={disksOver ? 'text-status-stale' : 'text-status-online'}
              footer={<span className="text-xs text-slate-500">{critStopped} crit. svc stopped</span>}
            />
            <KpiCard
              label="Avg load"
              value={avgCpu != null ? `${Math.round(avgCpu)}%` : '—'}
              accent={cpuAccent(avgCpu)}
              footer={
                <span className="text-xs text-slate-500">
                  RAM {avgRam != null ? `${Math.round(avgRam)}%` : '—'} · online avg
                </span>
              }
            />
          </div>

          {/* Full fleet at a glance */}
          <section className="card mt-4 overflow-hidden">
            <div className="panel-header flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <span>Fleet status</span>
              <span className="text-xs font-normal text-slate-500">{servers.length} devices</span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {servers.map((s) => (
                <FleetCell key={s.id} server={s} />
              ))}
            </div>
          </section>

          {/* Weekly checks + attention */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="card p-5 lg:col-span-1">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">Weekly checks</h2>
                <Link href="/checks/" className="text-xs font-medium text-brand-600 hover:underline">
                  View all
                </Link>
              </div>
              <p className="mb-4 text-xs text-slate-500">Click a segment to see those devices.</p>
              <WeeklyCheckDonut checks={checks} total={servers.length} />
            </section>

            <section className="card p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">Needs attention</h2>
                <Link href="/devices/" className="text-xs font-medium text-brand-600 hover:underline">
                  All devices
                </Link>
              </div>
              {attention.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-6 text-sm text-green-800">
                  <span className="h-2.5 w-2.5 rounded-full bg-status-online" />
                  Everything looks healthy — no devices need attention.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {attention.slice(0, 8).map((s) => (
                    <AttentionRow key={s.id} server={s} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  footer,
  accent,
  href,
}: {
  label: string;
  value: number | string;
  footer?: React.ReactNode;
  accent?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${accent ?? 'text-slate-900'}`}>
        {value}
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card card-hover block p-4">
        {inner}
      </Link>
    );
  }
  return <div className="card p-4">{inner}</div>;
}

function AttentionRow({ server }: { server: ServerListItem }) {
  const reasons: { label: string; cls: string }[] = [];
  if (server.status === 'offline') reasons.push({ label: 'Offline', cls: 'text-status-offline' });
  else if (server.status === 'stale') reasons.push({ label: 'Stale', cls: 'text-status-stale' });
  if (server.latest_check?.overall_status === 'fail')
    reasons.push({ label: 'Check failed', cls: 'text-status-offline' });
  else if (server.latest_check?.overall_status === 'warn')
    reasons.push({ label: 'Check warning', cls: 'text-status-stale' });
  const stopped = server.latest?.services?.stopped_critical?.length ?? 0;
  if (stopped > 0) reasons.push({ label: `${stopped} critical stopped`, cls: 'text-status-offline' });
  const down = pingsDown(server);
  if (down > 0) reasons.push({ label: `${down} LAN down`, cls: 'text-status-offline' });

  return (
    <li>
      <Link
        href={`/server/?id=${encodeURIComponent(server.id)}`}
        className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-slate-50"
      >
        <ClientLogo client={server.client_name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">{server.name}</div>
          <div className="truncate text-xs text-slate-500">{server.client_name}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-xs font-medium">
          {reasons.map((r, i) => (
            <span key={i} className={r.cls}>
              {r.label}
            </span>
          ))}
        </div>
        <span className="ml-1 whitespace-nowrap text-xs text-slate-400">
          {relativeAge(server.last_seen_at)}
        </span>
      </Link>
    </li>
  );
}

// Clickable SVG donut of weekly-check results. Segments route to the Devices
// page filtered by that result.
function WeeklyCheckDonut({
  checks,
  total,
}: {
  checks: Record<CheckStatus | 'none', number>;
  total: number;
}) {
  const router = useRouter();
  const segs: { key: CheckStatus | 'none'; label: string; value: number; color: string }[] = [
    { key: 'pass', label: 'Pass', value: checks.pass, color: '#16a34a' },
    { key: 'warn', label: 'Warn', value: checks.warn, color: '#d97706' },
    { key: 'fail', label: 'Fail', value: checks.fail, color: '#dc2626' },
    { key: 'none', label: 'No check yet', value: checks.none, color: '#94a3b8' },
  ];
  const sum = segs.reduce((a, s) => a + s.value, 0);

  const size = 180;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
            {sum > 0 &&
              segs.map((s) => {
                if (s.value === 0) return null;
                const len = (s.value / sum) * c;
                const el = (
                  <circle
                    key={s.key}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={stroke}
                    strokeDasharray={`${len} ${c - len}`}
                    strokeDashoffset={-offset}
                    className="cursor-pointer transition-[opacity] hover:opacity-80"
                    onClick={() => router.push(`/devices/?check=${s.key}`)}
                  >
                    <title>
                      {s.label}: {s.value}
                    </title>
                  </circle>
                );
                offset += len;
                return el;
              })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-semibold tabular-nums text-slate-900">{total}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">devices</div>
        </div>
      </div>

      <ul className="flex-1 space-y-1.5 text-sm">
        {segs.map((s) => (
          <li key={s.key}>
            <Link
              href={`/devices/?check=${s.key}`}
              className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-slate-600">{s.label}</span>
              <span className="ml-auto font-medium tabular-nums text-slate-900">{s.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function countChecks(servers: ServerListItem[]): Record<CheckStatus | 'none', number> {
  const out: Record<CheckStatus | 'none', number> = { pass: 0, warn: 0, fail: 0, none: 0 };
  for (const s of servers) {
    if (!s.latest_check) out.none++;
    else out[s.latest_check.overall_status]++;
  }
  return out;
}

function pingsDown(s: ServerListItem): number {
  return (s.latest?.pings ?? []).filter((p) => p.ok === false).length;
}

function needsAttention(s: ServerListItem): boolean {
  if (s.status === 'offline' || s.status === 'stale') return true;
  if (s.latest_check && (s.latest_check.overall_status === 'fail' || s.latest_check.overall_status === 'warn'))
    return true;
  if ((s.latest?.services?.stopped_critical?.length ?? 0) > 0) return true;
  if (pingsDown(s) > 0) return true;
  return false;
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function isNum(x: unknown): x is number {
  return typeof x === 'number' && !isNaN(x);
}
// Highest used% across a device's disks (100 - the lowest free%).
function worstDiskUsed(s: ServerListItem): number | null {
  const disks = s.latest?.disk ?? [];
  if (!disks.length) return null;
  return 100 - Math.min(...disks.map((d) => d.free_percent));
}
function cpuAccent(v: number | null): string {
  if (v == null) return 'text-slate-900';
  return v >= 90 ? 'text-status-offline' : v >= 75 ? 'text-status-stale' : 'text-status-online';
}

// One compact cell in the fleet grid: status-coloured, with CPU/RAM/Disk and the
// weekly-check result, so an office TV shows the whole estate at a glance.
function FleetCell({ server }: { server: ServerListItem }) {
  const cpu = server.latest?.cpu_percent ?? null;
  const ram =
    server.latest && server.latest.ram_total_mb
      ? ((server.latest.ram_used_mb ?? 0) / server.latest.ram_total_mb) * 100
      : null;
  const disk = worstDiskUsed(server);
  const offline = server.status === 'offline';
  const stale = server.status === 'stale';
  const accent = offline
    ? 'border-l-status-offline'
    : stale
      ? 'border-l-status-stale'
      : server.status === 'pending'
        ? 'border-l-slate-300'
        : 'border-l-status-online';

  return (
    <Link
      href={`/server/?id=${encodeURIComponent(server.id)}`}
      className={`block border-l-4 ${accent} p-3 transition-colors hover:bg-slate-50 ${
        offline ? 'bg-red-50' : 'bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{server.name}</div>
          <div className="truncate text-[11px] text-slate-500">{server.client_name}</div>
        </div>
        <StatusDot status={server.status} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-center">
        <Stat label="CPU" v={cpu} />
        <Stat label="RAM" v={ram} />
        <Stat label="Disk" v={disk} />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        {server.latest_check ? (
          <>
            <span className={`h-2 w-2 rounded-full ${CHECK_META[server.latest_check.overall_status].dot}`} />
            {CHECK_META[server.latest_check.overall_status].label}
          </>
        ) : (
          <span className="text-slate-400">No check</span>
        )}
        {pingsDown(server) > 0 && (
          <span className="font-medium text-status-offline">· {pingsDown(server)} LAN down</span>
        )}
        <span className="ml-auto">{relativeAge(server.last_seen_at)}</span>
      </div>
    </Link>
  );
}

function Stat({ label, v }: { label: string; v: number | null }) {
  const cls =
    v == null
      ? 'text-slate-400'
      : v >= 90
        ? 'text-status-offline'
        : v >= 75
          ? 'text-status-stale'
          : 'text-slate-700';
  return (
    <div>
      <div className={`text-sm font-semibold tabular-nums ${cls}`}>
        {v == null ? '—' : `${Math.round(v)}%`}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
