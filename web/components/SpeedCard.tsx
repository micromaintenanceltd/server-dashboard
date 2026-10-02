'use client';

import type { SpeedtestResult } from '@/lib/types';
import { relativeAge } from '@/lib/format';

function fmtMbps(v: number | null | undefined): string {
  if (v == null) return '—';
  return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Internet speed card: latest download/upload/ping, plus a 7-day download history.
export function SpeedCard({ tests }: { tests: SpeedtestResult[] }) {
  if (!tests || tests.length === 0) {
    return <p className="text-sm text-slate-400">No speed test yet — it runs once a day.</p>;
  }
  const latest = tests[0];
  const series = [...tests].reverse(); // oldest -> newest for the chart
  const maxDown = Math.max(1, ...series.map((t) => t.down_mbps ?? 0));

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Download" unit="Mbps" value={fmtMbps(latest.down_mbps)} icon="↓" accent="text-brand-700" />
        <Metric label="Upload" unit="Mbps" value={fmtMbps(latest.up_mbps)} icon="↑" />
        <Metric
          label="Ping"
          unit="ms"
          value={latest.ping_ms != null ? String(Math.round(latest.ping_ms)) : '—'}
        />
      </div>
      <div className="mt-1 text-center text-[11px] text-slate-400">
        {latest.server ? `${latest.server} · ` : ''}tested {relativeAge(latest.tested_at)}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-baseline justify-between text-xs text-slate-500">
          <span>Download · last 7 days</span>
          <span className="tabular-nums">{Math.round(maxDown)} Mbps peak</span>
        </div>
        <div className="flex h-16 items-end gap-1.5">
          {series.map((t, i) => {
            const h = Math.max(4, Math.round(((t.down_mbps ?? 0) / maxDown) * 100));
            return (
              <div
                key={i}
                className="group flex-1"
                title={`${fmtDay(t.tested_at)}: ↓ ${fmtMbps(t.down_mbps)} / ↑ ${fmtMbps(
                  t.up_mbps
                )} Mbps · ${t.ping_ms != null ? Math.round(t.ping_ms) + 'ms' : '—'}`}
              >
                <div
                  className="w-full rounded-sm bg-brand-600/80 transition-colors group-hover:bg-brand-700"
                  style={{ height: `${h}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  icon,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  icon?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className={`text-xl font-semibold tabular-nums ${accent ?? 'text-slate-900'}`}>
        {icon && <span className="mr-0.5 text-sm font-normal text-slate-400">{icon}</span>}
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {label} · {unit}
      </div>
    </div>
  );
}
