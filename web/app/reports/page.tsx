'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchServers } from '@/lib/api';
import type { ServerListItem, ServerStatus, CheckStatus } from '@/lib/types';
import { ClientLogo } from '@/components/ClientLogo';
import { STATUS_META, CHECK_META, formatUkDateTime, formatMb } from '@/lib/format';

type StatusFilter = ServerStatus | '';
type CheckFilter = CheckStatus | 'none' | '';

export default function ReportsPage() {
  const [servers, setServers] = useState<ServerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [client, setClient] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [check, setCheck] = useState<CheckFilter>('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchServers();
      setServers(res.servers);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    setGeneratedAt(new Date().toISOString());
  }, [load]);

  const clients = useMemo(
    () => Array.from(new Set(servers.map((s) => s.client_name).filter(Boolean))).sort(),
    [servers]
  );

  const rows = useMemo(
    () =>
      servers
        .filter((s) => {
          if (client && s.client_name !== client) return false;
          if (status && s.status !== status) return false;
          if (check) {
            if (check === 'none') return !s.latest_check;
            if (!s.latest_check || s.latest_check.overall_status !== check) return false;
          }
          return true;
        })
        .sort((a, b) => a.client_name.localeCompare(b.client_name) || a.name.localeCompare(b.name)),
    [servers, client, status, check]
  );

  const filtersActive = !!(client || status || check);
  const filterSummary = [
    client ? `Client: ${client}` : null,
    status ? `Status: ${STATUS_META[status].label}` : null,
    check ? `Weekly check: ${check === 'none' ? 'No check yet' : CHECK_META[check].label}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  function exportCsv() {
    const header = [
      'Device',
      'Client',
      'Location',
      'Status',
      'CPU %',
      'RAM %',
      'RAM used (MB)',
      'RAM total (MB)',
      'Worst disk %',
      'Disk mount',
      'Weekly check',
      'Fails',
      'Warns',
      'Last seen (UK)',
    ];
    const lines = rows.map((s) => {
      const ram =
        s.latest && s.latest.ram_total_mb
          ? Math.round(((s.latest.ram_used_mb ?? 0) / s.latest.ram_total_mb) * 100)
          : '';
      const disk = worstDisk(s);
      return [
        s.name,
        s.client_name,
        s.location ?? '',
        s.status,
        s.latest?.cpu_percent ?? '',
        ram,
        s.latest?.ram_used_mb ?? '',
        s.latest?.ram_total_mb ?? '',
        disk ? disk.percent : '',
        disk ? disk.mount : '',
        s.latest_check ? s.latest_check.overall_status : 'none',
        s.latest_check?.fail_count ?? '',
        s.latest_check?.warn_count ?? '',
        formatUkDateTime(s.last_seen_at),
      ]
        .map(csvCell)
        .join(',');
    });
    const csv = [header.join(','), ...lines].join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    download(`mml-report-${stamp}.csv`, csv, 'text/csv;charset=utf-8;');
  }

  const statusTotals = countStatus(rows);
  const checkTotals = countChecks(rows);

  return (
    <div className="px-8 py-6">
      {/* Controls (hidden when printing) */}
      <div className="no-print">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Reports</h1>
            <p className="text-sm text-slate-500">
              Filter, then print to PDF or export CSV. Leave filters blank for everything.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="btn-ghost px-3 py-1.5" disabled={rows.length === 0}>
              Export CSV
            </button>
            <button onClick={() => window.print()} className="btn-primary" disabled={rows.length === 0}>
              Print / Save PDF
            </button>
          </div>
        </header>

        <div className="card mb-6 flex flex-wrap items-end gap-3 p-4">
          <Select label="Client" value={client} onChange={setClient} options={[['', 'All clients'], ...clients.map((c) => [c, c] as [string, string])]} />
          <Select
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={[
              ['', 'All statuses'],
              ['online', 'Online'],
              ['stale', 'Stale'],
              ['offline', 'Offline'],
              ['pending', 'Pending'],
            ]}
          />
          <Select
            label="Weekly check"
            value={check}
            onChange={(v) => setCheck(v as CheckFilter)}
            options={[
              ['', 'All checks'],
              ['pass', 'Pass'],
              ['warn', 'Warn'],
              ['fail', 'Fail'],
              ['none', 'No check yet'],
            ]}
          />
          {filtersActive && (
            <button
              onClick={() => {
                setClient('');
                setStatus('');
                setCheck('');
              }}
              className="ml-auto text-sm font-medium text-brand-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* The report itself (this is what prints) */}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="card print-exact p-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-3">
              {client ? (
                <ClientLogo client={client} size={44} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/logo.png" alt="Micro Maintenance" className="h-11 w-11" />
              )}
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {client || 'All clients'} — Device Report
                </div>
                <div className="text-xs text-slate-500">
                  Micro Maintenance · generated {generatedAt ? formatUkDateTime(generatedAt) : ''}
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div className="text-2xl font-semibold tabular-nums text-slate-900">{rows.length}</div>
              device{rows.length === 1 ? '' : 's'}
            </div>
          </div>

          {filterSummary && (
            <div className="pt-3 text-xs text-slate-500">Filters — {filterSummary}</div>
          )}

          {/* Summary chips */}
          <div className="flex flex-wrap gap-4 py-4 text-sm">
            {(['online', 'stale', 'offline', 'pending'] as ServerStatus[]).map(
              (st) =>
                statusTotals[st] > 0 && (
                  <span key={st} className="inline-flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full bg-status-${st}`} />
                    <span className="text-slate-600">
                      {statusTotals[st]} {STATUS_META[st].label}
                    </span>
                  </span>
                )
            )}
            <span className="text-slate-300">|</span>
            {(['pass', 'warn', 'fail'] as CheckStatus[]).map((ck) => (
              <span key={ck} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${CHECK_META[ck].dot}`} />
                <span className="text-slate-600">
                  {checkTotals[ck]} {CHECK_META[ck].label}
                </span>
              </span>
            ))}
            {checkTotals.none > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-status-pending" />
                <span className="text-slate-600">{checkTotals.none} no check</span>
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No devices match these filters.</p>
          ) : (
            <table className="min-w-full border-t border-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Device</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">CPU</th>
                  <th className="py-2 pr-3">RAM</th>
                  <th className="py-2 pr-3">Disk</th>
                  <th className="py-2 pr-3">Weekly check</th>
                  <th className="py-2 pr-3">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {rows.map((s) => {
                  const ram =
                    s.latest && s.latest.ram_total_mb
                      ? Math.round(((s.latest.ram_used_mb ?? 0) / s.latest.ram_total_mb) * 100)
                      : null;
                  const disk = worstDisk(s);
                  return (
                    <tr key={s.id}>
                      <td className="py-2 pr-3 font-medium text-slate-900">
                        {s.name}
                        {s.location ? <div className="text-xs font-normal text-slate-400">{s.location}</div> : null}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{s.client_name}</td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full bg-status-${s.status}`} />
                          {STATUS_META[s.status].label}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">
                        {s.latest?.cpu_percent != null ? `${s.latest.cpu_percent}%` : '—'}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">
                        {ram != null ? `${ram}%` : '—'}
                        {s.latest?.ram_total_mb ? (
                          <div className="text-xs text-slate-400">
                            {formatMb(s.latest.ram_used_mb)} / {formatMb(s.latest.ram_total_mb)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">
                        {disk ? `${disk.percent}%` : '—'}
                        {disk ? <div className="text-xs text-slate-400">{disk.mount}</div> : null}
                      </td>
                      <td className="py-2 pr-3">
                        {s.latest_check ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${CHECK_META[s.latest_check.overall_status].dot}`} />
                            {CHECK_META[s.latest_check.overall_status].label}
                            {s.latest_check.fail_count + s.latest_check.warn_count > 0
                              ? ` (${s.latest_check.fail_count}f ${s.latest_check.warn_count}w)`
                              : ''}
                          </span>
                        ) : (
                          <span className="text-slate-400">No check yet</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-500">{formatUkDateTime(s.last_seen_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function worstDisk(s: ServerListItem): { mount: string; percent: number } | null {
  const disks = s.latest?.disk ?? [];
  if (!disks.length) return null;
  let worst = disks[0];
  for (const d of disks) if (d.free_percent < worst.free_percent) worst = d;
  return { mount: worst.mount, percent: Math.round(100 - worst.free_percent) };
}

function countStatus(rows: ServerListItem[]): Record<ServerStatus, number> {
  const c: Record<ServerStatus, number> = { online: 0, stale: 0, offline: 0, pending: 0 };
  for (const s of rows) c[s.status]++;
  return c;
}

function countChecks(rows: ServerListItem[]): Record<CheckStatus | 'none', number> {
  const c: Record<CheckStatus | 'none', number> = { pass: 0, warn: 0, fail: 0, none: 0 };
  for (const s of rows) {
    if (!s.latest_check) c.none++;
    else c[s.latest_check.overall_status]++;
  }
  return c;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
