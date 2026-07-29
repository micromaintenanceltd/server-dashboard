// IP allowlist for the technician + admin routes.
//
// Because there is no technician login, access to the dashboard API is
// restricted to a set of WAN IPs / CIDR ranges (typically the MML office).
// The list is configured in wrangler.toml (DASHBOARD_IP_ALLOWLIST) as a
// comma separated string, so more addresses can be added without code changes.
//
// Cloudflare puts the real client IP in the CF-Connecting-IP header.
// An empty allowlist means "allow all" (handy for local dev); set it before
// going live.

// Returns true if the request's client IP is allowed.
export function isIpAllowed(request: Request, allowlistRaw: string): boolean {
  const allowlist = (allowlistRaw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Empty allowlist = allow all (local dev / not yet configured).
  if (allowlist.length === 0) return true;

  const clientIp = request.headers.get('CF-Connecting-IP') || '';
  if (!clientIp) return false;

  return allowlist.some((entry) => matchesEntry(clientIp, entry));
}

function matchesEntry(ip: string, entry: string): boolean {
  if (entry.includes('/')) {
    const [range, bitsStr] = entry.split('/');
    const bits = parseInt(bitsStr, 10);
    if (Number.isNaN(bits)) return false;
    return inCidr(ip, range, bits);
  }
  // Exact match. Normalise so 1.2.3.4 compares cleanly.
  return normalise(ip) === normalise(entry);
}

function normalise(ip: string): string {
  return ip.trim().toLowerCase();
}

// CIDR containment check for IPv4 and IPv6.
function inCidr(ip: string, range: string, bits: number): boolean {
  const isV6 = ip.includes(':') || range.includes(':');
  const ipBytes = isV6 ? ipv6ToBytes(ip) : ipv4ToBytes(ip);
  const rangeBytes = isV6 ? ipv6ToBytes(range) : ipv4ToBytes(range);
  if (!ipBytes || !rangeBytes) return false;

  let bitsLeft = bits;
  for (let i = 0; i < ipBytes.length && bitsLeft > 0; i++) {
    const take = Math.min(8, bitsLeft);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((ipBytes[i] & mask) !== (rangeBytes[i] & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => Number(p));
  if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) return null;
  return bytes;
}

// Expands an IPv6 address (incl. "::" shorthand) to 16 bytes.
function ipv6ToBytes(ip: string): number[] | null {
  let clean = ip.trim().toLowerCase();
  // Not handling embedded IPv4 (::ffff:1.2.3.4) beyond a best effort.
  const hasDouble = clean.includes('::');
  const [head, tail = ''] = hasDouble ? clean.split('::') : [clean, ''];
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - (headGroups.length + tailGroups.length);
  if (missing < 0) return null;
  const groups = [
    ...headGroups,
    ...Array(hasDouble ? missing : 0).fill('0'),
    ...tailGroups,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    const val = parseInt(g || '0', 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    bytes.push((val >> 8) & 0xff, val & 0xff);
  }
  return bytes;
}
