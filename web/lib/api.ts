// Thin client for the Worker API.
//
// The API base URL is read from NEXT_PUBLIC_API_BASE at build time and falls
// back to the local wrangler dev server. Admin actions need the admin token,
// which the technician enters on the Admin page; we keep it in localStorage
// (this is an internal, IP-restricted tool with no per-user login).

import type { ServersResponse, ServerDetail } from './types';

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8787'
).replace(/\/+$/, '');

const ADMIN_TOKEN_KEY = 'mml_admin_token';

export function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = body && body.error ? body.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

// --- Technician (read) endpoints ---

export async function fetchServers(): Promise<ServersResponse> {
  const res = await fetch(`${API_BASE}/api/servers`, { cache: 'no-store' });
  return handle<ServersResponse>(res);
}

export async function fetchServer(id: string): Promise<ServerDetail> {
  const res = await fetch(`${API_BASE}/api/servers/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  });
  return handle<ServerDetail>(res);
}

// --- Admin (write) endpoints ---

function adminHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAdminToken()}`,
  };
}

export interface CreatedServer {
  server: { id: string; name: string; client_name: string; location: string | null };
  api_key: string;
  note: string;
}

export async function createServer(input: {
  name: string;
  client_name: string;
  location?: string;
}): Promise<CreatedServer> {
  const res = await fetch(`${API_BASE}/api/servers`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(input),
  });
  return handle<CreatedServer>(res);
}

export async function deleteServer(id: string): Promise<{ ok: boolean; deleted: string }> {
  const res = await fetch(`${API_BASE}/api/servers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  return handle(res);
}

export async function rotateKey(
  id: string
): Promise<{ server_id: string; api_key: string; note: string }> {
  const res = await fetch(`${API_BASE}/api/servers/${encodeURIComponent(id)}/rotate-key`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  return handle(res);
}
