// Small circular gauge (dial) for a 0-100% metric. Colour shifts amber/red as
// it fills, matching the old UsageBar thresholds. The percentage sits in the
// centre; a short label sits beneath. Pass `title` for the detailed value shown
// on hover (e.g. RAM GB used/total).
export function Dial({
  percent,
  label,
  title,
  size = 56,
}: {
  percent: number | null;
  label: string;
  title?: string;
  size?: number;
}) {
  const has = percent != null && !isNaN(percent);
  const p = has ? Math.max(0, Math.min(100, percent as number)) : 0;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (p / 100) * circumference;
  const colour =
    p >= 90 ? 'text-status-offline' : p >= 75 ? 'text-status-stale' : 'text-status-online';

  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-slate-200"
          />
          {has && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className={`${colour} transition-[stroke-dasharray] duration-500`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-slate-700">
          {has ? `${Math.round(p)}%` : '—'}
        </div>
      </div>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
    </div>
  );
}
