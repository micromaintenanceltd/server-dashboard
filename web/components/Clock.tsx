'use client';

import { useEffect, useState } from 'react';

// Live clock + date. Rendered client-side only (returns null until mounted) so a
// static export has nothing to hydrate-mismatch. Light, tabular type with a
// muted seconds and uppercase date reads cleanly on an office TV.
export function Clock({ size = 'md', tone = 'light' }: { size?: 'md' | 'lg'; tone?: 'light' | 'dark' }) {
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
  const dark = tone === 'dark';
  const mainCol = dark ? 'text-white' : 'text-slate-900';
  const sepCol = dark ? 'text-slate-600' : 'text-slate-300';
  const secCol = dark ? 'text-slate-500' : 'text-slate-400';
  const dateCol = dark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="text-right leading-none">
      <div className={`font-light tabular-nums tracking-tight ${mainCol} ${timeCls}`}>
        {h}
        <span className={sepCol}>:</span>
        {m}
        <span className={secCol}>:{s}</span>
      </div>
      <div className={`mt-1.5 font-medium uppercase tracking-[0.12em] ${dateCol} ${dateCls}`}>{date}</div>
    </div>
  );
}
