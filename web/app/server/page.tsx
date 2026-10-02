'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { fetchServer } from '@/lib/api';
import type { ServerDetail } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { LineChart, type ChartPoint } from '@/components/LineChart';
import { UsageBar } from '@/components/UsageBar';
import { UptimeCalendar } from '@/components/UptimeCalendar';
import { SpeedCard } from '@/components/SpeedCard';
import { formatUkDateTime, relativeAge, formatUptime, formatMb, CHECK_META } from '@/lib/format';

const POLL_MS = 30_000;

// useSearchParams must sit inside a Suspense boundary for static export.
export default function ServerDetailPage() {
  return (
    <Suspense fallback={<div className="px-8 py-6 text-sm text-slate-500">Loading...</div>}>
      <ServerDetailInner />
    </Suspense>
  );
}

function ServerDetailInner() {
  const params = useSearchParams();
  const id = params.get('id') || '';
  const [data, setData] = useState<ServerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'resources' | 'services' | 'antivirus' | 'updates'>('resources');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError('No device id provided.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetchServer(id);
      setData(res);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load device');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  if (loading && !data) {
    return <div className="px-8 py-6 text-sm text-slate-500">Loading server...</div>;
  }

  if (error) {
    return (
      <div className="px-4 py-5 sm:px-8 sm:py-6">
        <BackLink />
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { server, latest_report, history, latest_check, check_history } = data;
  const speedtests = data.speedtests ?? [];

  // Build chart series from history.
  const cpuSeries: ChartPoint[] = history.map((h) => ({ t: h.reported_at, v: h.cpu_percent }));
  const ramSeries: ChartPoint[] = history.map((h) => ({
    t: h.reported_at,
    v: h.ram_total_mb ? ((h.ram_used_mb ?? 0) / h.ram_total_mb) * 100 : null,
  }));

  // Disk trend: track the busiest volume (lowest free %) at each point.
  const diskSeries: ChartPoint[] = history.map((h) => {
    if (!h.disk?.length) return { t: h.reported_at, v: null };
    const worst = h.disk.reduce((a, b) => (b.free_percent < a.free_percent ? b : a));
    return { t: h.reported_at, v: 100 - worst.free_percent };
  });

  const av = (latest_report?.av ?? {}) as Record<string, any>;
  const patch = (latest_report?.patch ?? {}) as Record<string, any>;
  const meta = (latest_report?.meta ?? {}) as Record<string, any>;
  const services = latest_report?.services;
  const reboot = (meta.reboot ?? {}) as Record<string, any>;
  // Boot time: use the event-log value (0.4.5+) if present, otherwise derive it
  // from the uptime every agent reports (so the row shows on all versions).
  const bootAt: string | null =
    (reboot.last_boot_at as string) ||
    (latest_report && latest_report.uptime_seconds != null && latest_report.reported_at
      ? new Date(
          Date.parse(latest_report.reported_at) - (latest_report.uptime_seconds ?? 0) * 1000
        ).toISOString()
      : null);
  const pendingList: any[] = Array.isArray(patch.pending_list) ? patch.pending_list : [];

  return (
    <div className="px-4 py-5 sm:px-8 sm:py-6">
      <BackLink />

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{server.name}</h1>
            <StatusBadge status={server.status} />
            {meta.agent_version && (
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Agent v{meta.agent_version}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {server.client_name}
            {server.location ? ` · ${server.location}` : ''} · last seen{' '}
            {relativeAge(server.last_seen_at)} ({formatUkDateTime(server.last_seen_at)})
          </p>
        </div>
      </header>

      {/* Top metric summary */}
      <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard title="CPU">
          <div className="text-3xl font-semibold tabular-nums text-slate-900">
            {latest_report?.cpu_percent != null ? `${latest_report.cpu_percent}%` : 'n/a'}
          </div>
          <div className="mt-2">
            <UsageBar percent={latest_report?.cpu_percent ?? null} />
          </div>
        </MetricCard>
        <MetricCard title="Memory">
          <div className="text-3xl font-semibold tabular-nums text-slate-900">
            {latest_report && latest_report.ram_total_mb
              ? `${Math.round(((latest_report.ram_used_mb ?? 0) / latest_report.ram_total_mb) * 100)}%`
              : 'n/a'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {latest_report && latest_report.ram_total_mb
              ? `${formatMb(latest_report.ram_used_mb)} / ${formatMb(latest_report.ram_total_mb)}`
              : ''}
          </div>
          <div className="mt-2">
            <UsageBar
              percent={
                latest_report && latest_report.ram_total_mb
                  ? ((latest_report.ram_used_mb ?? 0) / latest_report.ram_total_mb) * 100
                  : null
              }
            />
          </div>
        </MetricCard>
        <MetricCard title="Uptime">
          <div className="text-3xl font-semibold tabular-nums text-slate-900">
            {formatUptime(latest_report?.uptime_seconds)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {meta.hostname ? `${meta.hostname} · ` : ''}
            {meta.os_version || ''}
          </div>
          {bootAt && (
            <div className="mt-1 text-xs text-slate-400">since {formatUkDateTime(bootAt)}</div>
          )}
        </MetricCard>
      </section>

      {/* Weekly checks (near the top) */}
      <section className="mb-6">
        <Panel title="Weekly checks">
          <WeeklyChecks latest={latest_check} history={check_history} />
        </Panel>
      </section>

      {/* Uptime history (30-day calendar) + internet speed */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card overflow-visible p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Uptime history</h2>
          <UptimeCalendar serverId={server.id} />
          {bootAt && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Last restart
                </span>
                <span className="text-sm text-slate-600">
                  {formatUkDateTime(bootAt)}{' '}
                  <span className="text-slate-400">({relativeAge(bootAt)})</span>
                </span>
              </div>
              {reboot.reason && <p className="mt-1 text-xs text-slate-500">{reboot.reason}</p>}
            </div>
          )}
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Internet speed</h2>
          <SpeedCard tests={speedtests} />
        </div>
      </section>

      {/* LAN ping monitors */}
      {Array.isArray(latest_report?.pings) && latest_report!.pings!.length > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Network monitors (LAN)</h2>
          <ul className="divide-y divide-slate-100">
            {latest_report!.pings!.map((p) => (
              <li key={p.host} className="flex items-center gap-3 py-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.ok ? 'bg-status-online' : 'bg-status-offline'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
                  <div className="truncate font-mono text-xs text-slate-500">{p.host}</div>
                </div>
                <span
                  className={`whitespace-nowrap text-sm font-medium ${p.ok ? 'text-status-online' : 'text-status-offline'}`}
                >
                  {p.ok ? (p.rtt_ms != null ? `${p.rtt_ms} ms` : 'Responding') : 'No response'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Details: resources / services / antivirus / updates in one tabbed card */}
      <section className="card mb-6 overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2 pt-2">
          {(
            [
              ['resources', 'Resources'],
              ['services', 'Services'],
              ['antivirus', 'Antivirus'],
              ['updates', 'Updates'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`whitespace-nowrap rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
                tab === key
                  ? 'border-b-2 border-brand-600 text-brand-700'
                  : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
              {key === 'updates' && patch.pending_updates ? (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  {patch.pending_updates}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'resources' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <TabChart title="CPU usage (7 days)">
                <LineChart points={cpuSeries} color="#2563eb" fixed0to100 unit="%" />
              </TabChart>
              <TabChart title="Memory usage (7 days)">
                <LineChart points={ramSeries} color="#7c3aed" fixed0to100 unit="%" />
              </TabChart>
              <TabChart title="Busiest disk used % (7 days)">
                <LineChart points={diskSeries} color="#0891b2" fixed0to100 unit="%" />
              </TabChart>
              <TabChart title="Disk volumes (latest)">
                <div className="space-y-3">
                  {(latest_report?.disk ?? []).length === 0 && (
                    <p className="text-sm text-slate-400">No disk data.</p>
                  )}
                  {(latest_report?.disk ?? []).map((d) => (
                    <UsageBar
                      key={d.mount}
                      percent={100 - d.free_percent}
                      label={`${d.mount} (${d.used_gb} / ${d.total_gb} GB)`}
                      sublabel={`${Math.round(100 - d.free_percent)}% used · ${d.free_percent}% free`}
                    />
                  ))}
                </div>
              </TabChart>
            </div>
          )}

          {tab === 'services' && <ServicesList services={services} />}

          {tab === 'antivirus' && (
            <KeyVals
              rows={[
                ['Product', av.product ?? 'unknown'],
                ['Installed', boolText(av.installed)],
                ['Running', boolText(av.running)],
                ['Last scan', av.last_scan ? formatUkDateTime(av.last_scan) : 'not available'],
                ...(av.notes ? [['Notes', String(av.notes)] as [string, string]] : []),
              ]}
            />
          )}

          {tab === 'updates' && (
            <div>
              <KeyVals
                rows={[
                  [
                    'Last update installed',
                    patch.last_update_installed
                      ? formatUkDateTime(patch.last_update_installed)
                      : 'not available',
                  ],
                  [
                    'Pending updates',
                    patch.pending_updates != null ? String(patch.pending_updates) : 'not available',
                  ],
                  ...(patch.notes ? [['Notes', String(patch.notes)] as [string, string]] : []),
                ]}
              />
              {pendingList.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Pending updates
                  </h3>
                  <ul className="space-y-1.5">
                    {pendingList.map((u, i) => {
                      const sev = String(u.severity || '');
                      const cats: string[] = Array.isArray(u.categories) ? u.categories : [];
                      const critical = sev === 'Critical' || cats.includes('Critical Updates');
                      return (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <SevBadge severity={sev} critical={critical} />
                          <span className="min-w-0 flex-1 text-slate-700">
                            {u.title}
                            {u.kb ? <span className="text-slate-400"> · KB{u.kb}</span> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Raw last report */}
      <section className="mb-10">
        <Panel title="Raw last report">
          <p className="mb-2 text-xs text-slate-500">
            Reported at {latest_report ? formatUkDateTime(latest_report.reported_at) : 'never'}
          </p>
          <pre className="max-h-96 overflow-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {JSON.stringify(latest_report ?? {}, null, 2)}
          </pre>
        </Panel>
      </section>
    </div>
  );
}

function TabChart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function SevBadge({ severity, critical }: { severity: string; critical: boolean }) {
  const label = critical ? 'Critical' : severity || 'Update';
  const cls = critical
    ? 'bg-red-100 text-red-700'
    : severity === 'Important'
      ? 'bg-amber-100 text-amber-800'
      : severity === 'Moderate'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function ServicesList({ services }: { services: any }) {
  const watched = services?.watched ?? [];
  const top = services?.top_processes ?? [];
  if (watched.length === 0 && top.length === 0) {
    return <p className="text-sm text-slate-400">No service data.</p>;
  }
  return (
    <div className="space-y-4">
      {watched.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {watched.map((s: any) => (
            <li key={s.name} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">
                  {s.display_name || s.name}
                </div>
                <div className="truncate text-xs text-slate-400">{s.name}</div>
              </div>
              <div className="flex items-center gap-2">
                {s.critical && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                    critical
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                    s.running ? 'text-status-online' : 'text-status-offline'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      s.running ? 'bg-status-online' : 'bg-status-offline'
                    }`}
                  />
                  {s.running ? 'Running' : 'Stopped'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {top.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Top processes
          </div>
          <ul className="text-sm text-slate-600">
            {top.map((p: any, i: number) => (
              <li key={i} className="flex justify-between py-0.5">
                <span className="truncate">{p.name}</span>
                <span className="tabular-nums text-slate-400">
                  {p.mem_mb != null ? `${p.mem_mb} MB` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WeeklyChecks({
  latest,
  history,
}: {
  latest: ServerDetail['latest_check'];
  history: ServerDetail['check_history'];
}) {
  if (!latest) {
    return (
      <p className="text-sm text-slate-400">
        No weekly check has run yet. The first run happens at the scheduled time (Monday 07:00 UK by
        default), or immediately if the server was off at that time.
      </p>
    );
  }

  const meta = CHECK_META[latest.overall_status];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
        >
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          Overall: {meta.label}
        </span>
        <span className="text-xs text-slate-500">
          {latest.pass_count} pass, {latest.warn_count} warn, {latest.fail_count} fail
        </span>
        <span className="text-xs text-slate-400">
          Ran {formatUkDateTime(latest.run_at)} ({relativeAge(latest.run_at)})
        </span>
      </div>

      <ul className="divide-y divide-slate-100">
        {latest.results.map((r) => {
          const m = CHECK_META[r.status];
          return (
            <li key={r.id} className="flex items-start gap-3 py-2">
              <span
                className={`mt-0.5 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${m.badge}`}
              >
                {m.label}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">{r.title}</div>
                <div className="text-xs text-slate-500">{r.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>

      {history.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Recent runs
          </div>
          <div className="flex flex-wrap gap-1.5">
            {history.map((h, i) => (
              <span
                key={i}
                title={`${formatUkDateTime(h.run_at)} - ${h.fail_count} fail, ${h.warn_count} warn`}
                className={`h-3 w-3 rounded-sm ${CHECK_META[h.overall_status].dot}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </div>
  );
}

function KeyVals({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-right font-medium text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function BackLink() {
  return (
    <Link href="/devices/" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Back to devices
    </Link>
  );
}

function boolText(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return 'unknown';
}
