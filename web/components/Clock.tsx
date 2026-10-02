'use client';

import { useEffect, useState } from 'react';

// Live clock + date. Rendered client-side only (returns null until mounted) so a
// static export has nothing to hydrate-mismatch. Light, tabular type with a
// muted seconds and uppercase date reads cleanly on an office TV.
export function Clock({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const date = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const timeCls = size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl';
  const dateCls = size === 'lg' ? 'text-xs sm:text-sm' : 'text-[11px] sm:text-xs';

  return (
    <div className="text-right leading-none">
      <div className={`font-light tabular-nums tracking-tight text-slate-900 ${timeCls}`}>
        {h}
        <span className="text-slate-300">:</span>
        {m}
        <span className="text-slate-400">:{s}</span>
      </div>
      <div className={`mt-1.5 font-medium uppercase tracking-[0.12em] text-slate-500 ${dateCls}`}>
        {date}
      </div>
    </div>
  );
}
