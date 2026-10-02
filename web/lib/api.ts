// Client for the Worker API. Authentication is a built-in login: the user signs
// in, we store a session token, and attach it as a Bearer header on every call.

import type {
  ServersResponse,
  ServerDetail,
  AuthUser,
  ManagedUser,
  UserRole,
} from './types';

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8787'
).replace(/\/+$/, '');

const TOKEN_KEY = 'mml_session_token';

export function getToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage failures
  }
}
export function clearToken(): void {
  setToken('');
}

// Thrown on a 401 so callers/guards can send the user to the login page.
export class AuthError extends Error {}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const t = getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = body && body.error ? body.error : `Request failed (${res.status})`;
    if (res.status === 401) {
      // Only an authenticated request returning 401 means the session expired;
      // the login endpoints (auth: false) legitimately 401 on bad credentials.
      if (opts.auth !== false && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mml:auth-expired'));
      }
      throw new AuthError(msg);
    }
    throw new Error(msg);
  }
  return body as T;
}

// --- Auth ---

export interface LoginResult {
  token?: string;
  user?: AuthUser;
  mfa_required?: boolean;
  mfa_token?: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return request<LoginResult>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
}

export async function mfaVerify(mfaToken: string, code: string): Promise<LoginResult> {
  return request<LoginResult>('/api/auth/mfa/verify', {
    method: 'POST',
    body: { mfa_token: mfaToken, code },
    auth: false,
  });
}

export async function fetchMe(): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/api/me');
}

export async function changePassword(
  current_password: string,
  new_password: string
): Promise<{ ok: boolean; token: string }> {
  return request('/api/auth/password', { method: 'POST', body: { current_password, new_password } });
}

export async function mfaSetup(): Promise<{ secret: string; otpauth_uri: string }> {
  return request('/api/auth/mfa/setup', { method: 'POST', body: {} });
}
export async function mfaEnable(code: string): Promise<{ ok: boolean; recovery_codes: string[] }> {
  return request('/api/auth/mfa/enable', { method: 'POST', body: { code } });
}
export async function mfaDisable(password: string): Promise<{ ok: boolean }> {
  return request('/api/auth/mfa/disable', { method: 'POST', body: { password } });
}

// --- Users (admin) ---

export async function listUsers(): Promise<{ users: ManagedUser[] }> {
  return request('/api/users');
}
export async function createUser(input: {
  email: string;
  role: UserRole;
  password: string;
  send_invite?: boolean;
}): Promise<{ ok: boolean; emailed: boolean; email_error: string | null }> {
  return request('/api/users', { method: 'POST', body: input });
}
export async function setUserRole(id: string, role: UserRole): Promise<{ ok: boolean }> {
  return request(`/api/users/${encodeURIComponent(id)}/role`, { method: 'POST', body: { role } });
}
export async function resetUserPassword(id: string, new_password: string): Promise<{ ok: boolean }> {
  return request(`/api/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    body: { new_password },
  });
}
export async function setUserDisabled(id: string, disabled: boolean): Promise<{ ok: boolean }> {
  return request(`/api/users/${encodeURIComponent(id)}/disable`, {
    method: 'POST',
    body: { disabled },
  });
}
export async function deleteUser(id: string): Promise<{ ok: boolean }> {
  return request(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Servers (read: any user; write: admin, enforced server-side) ---

export async function fetchServers(): Promise<ServersResponse> {
  return request('/api/servers');
}
export async function fetchServer(id: string): Promise<ServerDetail> {
  return request(`/api/servers/${encodeURIComponent(id)}`);
}

export interface UptimeOutage {
  start: number;
  end: number;
  ongoing?: boolean;
}
export interface UptimeResponse {
  staleMinutes: number;
  windowStart: number;
  now: number;
  firstReport: number | null;
  lastReport: number | null;
  outages: UptimeOutage[];
}
export async function fetchUptime(id: string): Promise<UptimeResponse> {
  return request(`/api/servers/${encodeURIComponent(id)}/uptime`);
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
  return request('/api/servers', { method: 'POST', body: input });
}
export async function deleteServer(id: string): Promise<{ ok: boolean; deleted: string }> {
  return request(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function decommissionServer(
  id: string
): Promise<{ ok: boolean; server_id: string; note: string }> {
  return request(`/api/servers/${encodeURIComponent(id)}/decommission`, { method: 'POST', body: {} });
}
export async function rotateKey(
  id: string
): Promise<{ server_id: string; api_key: string; note: string }> {
  return request(`/api/servers/${encodeURIComponent(id)}/rotate-key`, { method: 'POST', body: {} });
}

// --- Per-company logos ---

export async function fetchClientLogos(): Promise<{ logos: Record<string, string> }> {
  return request('/api/client-logos');
}
// Pass data_url = null to clear a company's logo.
export async function saveClientLogo(
  client_name: string,
  data_url: string | null
): Promise<{ ok: boolean }> {
  return request('/api/client-logos', { method: 'POST', body: { client_name, data_url } });
}

// --- Alerts (admin) ---

export interface AlertConfigView {
  teams_set: boolean;
  email_key_set: boolean;
  email_to: string;
  email_from: string;
  freshdesk_key_set: boolean;
  freshdesk_domain: string;
  freshdesk_email: string;
  freshdesk_group_id: string;
  on_check_fail: boolean;
  on_offline: boolean;
  on_crit_stopped: boolean;
  on_ping_down: boolean;
}
export async function fetchAlertConfig(): Promise<AlertConfigView> {
  return request('/api/alert-config');
}
export async function saveAlertConfig(body: Record<string, unknown>): Promise<{ ok: boolean }> {
  return request('/api/alert-config', { method: 'POST', body });
}
export async function testAlert(): Promise<{
  ok: boolean;
  teams: boolean | null;
  email: boolean | null;
  freshdesk: boolean | null;
  freshdesk_ticket: string | null;
  errors: string[];
}> {
  return request('/api/alert-config/test', { method: 'POST', body: {} });
}

// --- Agent auto-update (admin) ---

export interface AgentReleaseView {
  version: string | null;
  downloadUrl?: string;
  sha256?: string;
  enabled?: boolean;
  notes?: string;
  updated_at?: string | null;
}
export async function fetchAgentRelease(): Promise<AgentReleaseView> {
  return request('/api/agent/release');
}
export async function setAgentReleaseEnabled(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
  return request('/api/agent/release/enabled', { method: 'POST', body: { enabled } });
}
