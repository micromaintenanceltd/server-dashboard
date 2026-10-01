'use client';

import { useClientLogos } from './ClientLogosProvider';

// Shows a client's company logo next to a device. If the company has an
// uploaded logo it renders that; otherwise it falls back to a tidy initials
// badge in the brand colour. An explicit `logoUrl` overrides the lookup.
export function ClientLogo({
  client,
  logoUrl,
  size = 32,
}: {
  client: string | null | undefined;
  logoUrl?: string | null;
  size?: number;
}) {
  const { logos } = useClientLogos();
  const name = (client || '').trim();
  const resolved = logoUrl ?? (name ? logos[name] : undefined) ?? null;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  if (resolved) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved}
        alt={name ? `${name} logo` : 'Company logo'}
        className="shrink-0 rounded-md border border-slate-200 bg-white object-contain p-0.5"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md border border-brand-100 bg-brand-50 font-semibold text-brand-700"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      title={name || undefined}
      aria-hidden
    >
      {initials}
    </div>
  );
}
