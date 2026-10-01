'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchServers, fetchServer } from '@/lib/api';
import type { ServerListItem, CheckResult, CheckStatus } from '@/lib/types';
import { ClientLogo } from '@/components/ClientLogo';
import { relativeAge, formatUkDateTime, CHECK_META } from '@/lib/format';

type DetailState = {
  loading: boolean;
  error?: string;
  results?: CheckResult[];
  runAt?: string | null;
  agent?: string | null;
};

type ResultFilter = 'all' | CheckStatus | 'none';

// Sort order so the devices needing attention float to the top.
const SEVERITY: Record<string, number> = { fail: 0, warn: 1, none: 2, pass: 3 };

export default function WeeklyChecksPage() {
  const [servers, setServers] = useState<ServerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [filter, setFilter] = useState<ResultFilter>('all');

  const load = useCallback(async () => {
    try {
      const res = await fetchServers();
      setServers(res.servers);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load weekly checks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetails((d) => ({ ...d, [id]: { loading: true } }));
    try {
      const r = await fetchServer(id);
      setDetails((d) => ({
        ...d,
        [id]: {
          loading: false,
          results: r.latest_check?.results ?? [],
          runAt: r.latest_check?.run_at ?? null,
          agent: r.latest_check?.agent_version ?? null,
        },
      }));
    } catch (err: any) {
      setDetails((d) => ({ ...d, [id]: { loading: false, error: err.message || 'Failed to load checks' } }));
    }
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setOpenId((cur) => (cur === id ? null : id));
      setDetails((d) => {
        if (!d[id]) fetchDetail(id);
        return d;
      });
    },
    [fetchDetail]
  );

  const counts = { all: servers.length, pass: 0, warn: 0, fail: 0, none: 0 } as Record<ResultFilter, number>;
  for (const s of servers) {
    if (!s.latest_check) counts.none++;
    else counts[s.latest_check.overall_status]++;
  }

  const shown = servers
    .filter((s) => {
      if (filter === 'all') return true;
      if (filter === 'none') return !s.latest_check;
      return s.latest_check?.overall_status === filter;
    })
    .sort((a, b) => {
      const sa = SEVERITY[a.latest_check?.overall_status ?? 'none'] ?? 2;
      const sb = SEVERITY[b.latest_check?.overall_status ?? 'none'] ?? 2;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });

  const filters: { key: ResultFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'fail', label: 'Fail' },
    { key: 'warn', label: 'Warn' },
    { key: 'pass', label: 'Pass' },
    { key: 'none', label: 'No check yet' },
  ];

  return (
    <div className="px-8 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Weekly Checks</h1>
          <p className="text-sm text-slate-500">
            Backup &amp; health check results per device. Click a device to see each check.
          </p>
        </div>
        <button onClick={load} className="btn-ghost px-3 py-1.5">
          Refresh
        </button>
      </header>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              filter === f.key
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.key !== 'all' && (
              <span
                className={`h-2 w-2 rounded-full ${
                  f.key === 'none' ? 'bg-status-pending' : CHECK_META[f.key as CheckStatus].dot
                }`}
              />
            )}
            {f.label}
            <span className="tabular-nums text-slate-400">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
          No devices match this filter.
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {shown.map((s) => (
            <CheckRow
              key={s.id}
              server={s}
              open={openId === s.id}
              detail={details[s.id]}
              onToggle={() => toggle(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckRow({
  server,
  open,
  detail,
  onToggle,
}: {
  server: ServerListItem;
  open: boolean;
  detail?: DetailState;
  onToggle: () => void;
}) {
  const lc = server.latest_check;
  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <Chevron open={open} />
        <ClientLogo client={server.client_name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">{server.name}</div>
          <div className="truncate text-xs text-slate-500">{server.client_name}</div>
        </div>
        {lc ? (
          <div className="flex items-center gap-3">
            {lc.fail_count > 0 && <CountPill n={lc.fail_count} kind="fail" />}
            {lc.warn_count > 0 && <CountPill n={lc.warn_count} kind="warn" />}
            {lc.pass_count > 0 && <CountPill n={lc.pass_count} kind="pass" />}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHECK_META[lc.overall_status].badge}`}
            >
              <span className={`h-2 w-2 rounded-full ${CHECK_META[lc.overall_status].dot}`} />
              {CHECK_META[lc.overall_status].label}
            </span>
            <span className="hidden whitespace-nowrap text-xs text-slate-400 sm:inline">
              {relativeAge(lc.run_at)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">No check yet</span>
        )}
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {!detail || detail.loading ? (
            <p className="text-sm text-slate-500">Loading checks…</p>
          ) : detail.error ? (
            <p className="text-sm text-red-600">{detail.error}</p>
          ) : !detail.results || detail.results.length === 0 ? (
            <p className="text-sm text-slate-500">No weekly check has been recorded for this device yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-slate-200/70">
                {detail.results.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-2">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${CHECK_META[r.status].dot}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800">{r.title}</div>
                      {r.detail && <div className="text-xs text-slate-500">{r.detail}</div>}
                    </div>
                    <span
                      className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHECK_META[r.status].badge}`}
                    >
                      {CHECK_META[r.status].label}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs text-slate-400">
                Ran {detail.runAt ? formatUkDateTime(detail.runAt) : 'unknown'}
                {detail.agent ? ` · agent v${detail.agent}` : ''}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CountPill({ n, kind }: { n: number; kind: CheckStatus }) {
  const label = kind === 'fail' ? 'fail' : kind === 'warn' ? 'warn' : 'pass';
  return (
    <span className="hidden items-center gap-1 text-xs text-slate-500 md:inline-flex">
      <span className={`h-1.5 w-1.5 rounded-full ${CHECK_META[kind].dot}`} />
      <span className="tabular-nums">{n}</span>
      <span className="text-slate-400">{label}</span>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
