// Horizontal usage bar with a colour that shifts amber/red as it fills.
export function UsageBar({
  percent,
  label,
  sublabel,
}: {
  percent: number | null;
  label?: string;
  sublabel?: string;
}) {
  const p = percent == null || isNaN(percent) ? 0 : Math.max(0, Math.min(100, percent));
  const colour = p >= 90 ? 'bg-status-offline' : p >= 75 ? 'bg-status-stale' : 'bg-status-online';
  return (
    <div>
      {(label || sublabel) && (
        <div className="mb-1 flex items-baseline justify-between text-xs text-slate-600">
          <span>{label}</span>
          <span className="tabular-nums">{sublabel}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
