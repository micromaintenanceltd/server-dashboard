'use client';

// Shows a client's company logo next to a device. Until per-company logo upload
// is wired up (and for clients without a logo), it falls back to a tidy
// initials badge in the brand colour. `logoUrl` will be supplied once logos are
// stored; passing it renders the image instead of initials.
export function ClientLogo({
  client,
  logoUrl,
  size = 32,
}: {
  client: string | null | undefined;
  logoUrl?: string | null;
  size?: number;
}) {
  const name = (client || '').trim();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
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
