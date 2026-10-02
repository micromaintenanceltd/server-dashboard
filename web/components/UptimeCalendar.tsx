'use client';

import { useEffect, useState } from 'react';
import { fetchUptime, type UptimeResponse, type UptimeOutage } from '@/lib/api';

type DayStatus = 'up' | 'partial' | 'down' | 'nodata';

interface Day {
  start: number;
  end: number;
  status: DayStatus;
  downMs: number;
  outages: UptimeOutage[];
}

const DAY_MS = 24 * 3600_000;

function fmtDur(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildDays(data: UptimeResponse, days = 30): Day[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: Day[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = today.getTime() - i * DAY_MS;
    const end = start + DAY_MS;
    const dayOutages = data.outages
      .map((o) => ({
        start: Math.max(o.start, start),
        end: Math.min(o.end, Math.min(end, data.now)),
        ongoing: o.ongoing,
      }))
      .filter((o) => o.end > o.start);
    const downMs = dayOutages.reduce((a, o) => a + (o.end - o.start), 0);

    let status: DayStatus;
    if (data.firstReport == null || end <= data.firstReport) {
      status = 'nodata';
    } else {
      const downMin = downMs / 60_000;
      status = downMin < 5 ? 'up' : downMin > 12 * 60 ? 'down' : 'partial';
    }
    out.push({ start, end, status, downMs, outages: dayOutages });
  }
  return out;
}

const COLOUR: Record<DayStatus, string> = {
  up: 'bg-status-online',
  partial: 'bg-status-stale',
  down: 'bg-status-offline',
  nodata: 'bg-slate-200',
};

export function UptimeCalendar({ serverId }: { serverId: string }) {
  const [data, setData] = useState<UptimeResponse | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let active = true;
    fetchUptime(serverId)
      .then((d) => active && setData(d))
      .catch(() => active && setErr(true));
    return () => {
      active = false;
    };
  }, [serverId]);

  if (err) return <p className="text-xs text-slate-400">Couldn’t load uptime history.</p>;
  if (!data) return <p className="text-xs text-slate-400">Loading uptime history…</p>;

  const days = buildDays(data);
  const known = days.filter((d) => d.status !== 'nodata');
  const totalKnownMs = known.reduce((a, d) => a + Math.min(d.end, data.now) - d.start, 0);
  const totalDownMs = known.reduce((a, d) => a + d.downMs, 0);
  const pct = totalKnownMs > 0 ? Math.round(((totalKnownMs - totalDownMs) / totalKnownMs) * 1000) / 10 : null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs text-slate-500">Last 30 days</span>
        {pct != null && (
          <span className="text-xs font-semibold tabular-nums text-slate-700">{pct}% up</span>
        )}
      </div>

      <div className="flex gap-1">
        {days.map((d, i) => {
          // Keep the popover on-screen: anchor left near the start, right near
          // the end, centred in the middle.
          const posCls =
            i < 4 ? 'left-0' : i >= days.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2';
          return (
          <div key={i} className="group relative flex-1">
            <div
              className={`h-9 rounded-sm ${COLOUR[d.status]} cursor-pointer transition-transform hover:scale-y-110`}
            />
            {/* Hover popover with that day's detail. */}
            <div className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden w-60 max-w-[70vw] group-hover:block ${posCls}`}>
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{fmtDay(d.start)}</span>
                  <StatusPill status={d.status} downMs={d.downMs} />
                </div>
                {d.status === 'nodata' ? (
                  <p className="text-slate-500">No monitoring data.</p>
                ) : d.outages.length === 0 ? (
                  <p className="text-status-online">Online all day — no downtime.</p>
                ) : (
                  <ul className="space-y-1">
                    {d.outages.map((o, j) => (
                      <li key={j} className="flex items-center justify-between gap-2 text-slate-600">
                        <span className="tabular-nums">
                          {fmtTime(o.start)} → {o.ongoing ? 'now' : fmtTime(o.end)}
                        </span>
                        <span className="shrink-0 font-medium text-status-offline">
                          {o.ongoing ? 'ongoing' : fmtDur(o.end - o.start)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">30 days ago</span>
        <Legend />
        <span className="text-[10px] text-slate-400">Today</span>
      </div>
    </div>
  );
}

function StatusPill({ status, downMs }: { status: DayStatus; downMs: number }) {
  const map: Record<DayStatus, { label: string; cls: string }> = {
    up: { label: 'Up', cls: 'bg-green-100 text-green-800' },
    partial: { label: fmtDur(downMs) + ' down', cls: 'bg-amber-100 text-amber-800' },
    down: { label: fmtDur(downMs) + ' down', cls: 'bg-red-100 text-red-800' },
    nodata: { label: 'No data', cls: 'bg-slate-100 text-slate-600' },
  };
  const m = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function Legend() {
  const items: { s: DayStatus; label: string }[] = [
    { s: 'up', label: 'Up' },
    { s: 'partial', label: 'Partial' },
    { s: 'down', label: 'Down' },
    { s: 'nodata', label: 'No data' },
  ];
  return (
    <div className="flex items-center gap-2.5">
      {items.map((i) => (
        <span key={i.s} className="inline-flex items-center gap-1 text-[10px] text-slate-400">
          <span className={`h-2 w-2 rounded-sm ${COLOUR[i.s]}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
