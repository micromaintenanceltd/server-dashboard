// UniFi-style uptime history strip. Derives up/down over a window from the
// device's report timestamps: a time bucket with at least one report is "up",
// a bucket with none (after monitoring began) is "down", and buckets before the
// first report are "no data". Hover a segment for its time range and status.

interface Seg {
  status: 'up' | 'down' | 'nodata';
  t0: number;
  t1: number;
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UptimeBar({
  history,
  windowDays = 7,
  buckets = 96,
}: {
  history: { reported_at: string }[];
  windowDays?: number;
  buckets?: number;
}) {
  const now = Date.now();
  const start = now - windowDays * 24 * 3600_000;
  const span = (now - start) / buckets;

  const times = history
    .map((h) => Date.parse(h.reported_at))
    .filter((t) => !isNaN(t) && t >= start)
    .sort((a, b) => a - b);

  const up = new Array(buckets).fill(false);
  for (const t of times) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((t - start) / span)));
    up[idx] = true;
  }
  // Bucket in which monitoring first appears within the window.
  const firstIdx = times.length ? Math.floor((times[0] - start) / span) : buckets;

  const segs: Seg[] = up.map((isUp, i) => {
    const t0 = start + i * span;
    const status: Seg['status'] = isUp ? 'up' : i < firstIdx ? 'nodata' : 'down';
    return { status, t0, t1: t0 + span };
  });

  const known = segs.filter((s) => s.status !== 'nodata');
  const upCount = segs.filter((s) => s.status === 'up').length;
  const pct = known.length ? Math.round((upCount / known.length) * 1000) / 10 : null;

  const colour = (s: Seg['status']) =>
    s === 'up' ? 'bg-status-online' : s === 'down' ? 'bg-status-offline' : 'bg-slate-200';
  const label = (s: Seg['status']) => (s === 'up' ? 'Online' : s === 'down' ? 'Offline' : 'No data');

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs text-slate-500">Last {windowDays} days</span>
        {pct != null && (
          <span className="text-xs font-semibold tabular-nums text-slate-700">{pct}% up</span>
        )}
      </div>
      <div className="flex h-7 gap-px overflow-hidden rounded">
        {segs.map((s, i) => (
          <div
            key={i}
            className={`h-full flex-1 ${colour(s.status)}`}
            title={`${fmt(s.t0)} – ${fmt(s.t1)}: ${label(s.status)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{windowDays} days ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
