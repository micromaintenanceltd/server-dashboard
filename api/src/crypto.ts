// Helpers for API key generation and hashing.
//
// Keys are shown to the admin exactly once at creation time. We only ever
// store a SHA-256 hash in D1, so a database leak does not expose usable keys.

// Generate a new random API key. Format: "mml_<43 base64url chars>".
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'mml_' + base64url(bytes);
}

// SHA-256 hash of a raw key, returned as lowercase hex.
export async function hashApiKey(rawKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawKey);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

// A short, non-secret prefix stored for display (helps identify a key in the UI).
export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
