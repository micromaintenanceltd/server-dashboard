import type { ServerStatus } from '@/lib/types';
import { STATUS_META } from '@/lib/format';

// Coloured pill showing a server's status.
export function StatusBadge({ status }: { status: ServerStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

// Just the coloured dot (for compact rows).
export function StatusDot({ status }: { status: ServerStatus }) {
  const meta = STATUS_META[status];
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dot}`} />;
}
