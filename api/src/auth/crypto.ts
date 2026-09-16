// Password hashing (PBKDF2) and signed tokens (HS256 JWT), using Web Crypto so
// it runs on Cloudflare Workers. No native/bcrypt dependency.

// --- byte / base64url helpers ---

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlFromBytes(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlFromString(s: string): string {
  return b64urlFromBytes(enc.encode(s));
}
function b64urlToString(s: string): string {
  return dec.decode(b64urlToBytes(s));
}

// Constant-time comparison.
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// --- password hashing (PBKDF2-HMAC-SHA256) ---

const PBKDF2_ITERATIONS = 210000; // OWASP-recommended floor for PBKDF2-SHA256

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

// Returns an encoded string: pbkdf2$<iterations>$<saltB64url>$<hashB64url>
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlFromBytes(salt)}$${b64urlFromBytes(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations)) return false;
  const salt = b64urlToBytes(parts[2]);
  const expected = b64urlToBytes(parts[3]);
  const derived = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(derived, expected);
}

// --- HS256 JWT (session + short-lived pre-auth tokens) ---

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(
    JSON.stringify(body)
  )}`;
  const sig = await hmacSha256(secret, signingInput);
  return `${signingInput}.${b64urlFromBytes(sig)}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<Record<string, any> | null> {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const expected = await hmacSha256(secret, `${h}.${p}`);
    if (!timingSafeEqual(b64urlToBytes(s), expected)) return null;
    const payload = JSON.parse(b64urlToString(p)) as Record<string, any>;
    if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
