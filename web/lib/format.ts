// Display helpers. All timestamps render in UK time (Europe/London), which
// handles GMT/BST automatically via the Intl API.

import type { ServerStatus, CheckStatus } from './types';

const UK_TZ = 'Europe/London';

// e.g. "23 Jul 2026, 14:32:05"
export function formatUkDateTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

// Short relative age, e.g. "3 min ago", "2 h ago", "just now".
export function relativeAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return 'unknown';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

// "10d 4h 12m" from seconds.
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return 'unknown';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export function formatMb(mb: number | null | undefined): string {
  if (mb == null || isNaN(mb)) return 'n/a';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

// Tailwind-friendly status metadata.
export const STATUS_META: Record<
  ServerStatus,
  { label: string; dot: string; text: string; badge: string }
> = {
  online: {
    label: 'Online',
    dot: 'bg-status-online',
    text: 'text-status-online',
    badge: 'bg-green-100 text-green-800 border-green-200',
  },
  stale: {
    label: 'Stale',
    dot: 'bg-status-stale',
    text: 'text-status-stale',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-status-offline',
    text: 'text-status-offline',
    badge: 'bg-red-100 text-red-800 border-red-200',
  },
  pending: {
    label: 'Pending',
    dot: 'bg-status-pending',
    text: 'text-status-pending',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

// Check status metadata (pass / warn / fail).
export const CHECK_META: Record<
  CheckStatus,
  { label: string; dot: string; badge: string }
> = {
  pass: { label: 'Pass', dot: 'bg-status-online', badge: 'bg-green-100 text-green-800 border-green-200' },
  warn: { label: 'Warn', dot: 'bg-status-stale', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  fail: { label: 'Fail', dot: 'bg-status-offline', badge: 'bg-red-100 text-red-800 border-red-200' },
};
