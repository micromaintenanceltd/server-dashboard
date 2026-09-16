// User records and session resolution for the built-in login system.

import type { Env } from '../types';
import { verifyJwt } from './crypto';

export type UserRole = 'admin' | 'tech';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  mfa_secret: string | null;
  mfa_enabled: number; // 0 | 1
  recovery_codes: string | null; // JSON array of hashed codes
  token_version: number;
  disabled: number; // 0 | 1
  failed_attempts: number;
  lockout_until: string | null; // ISO
  created_at: string;
  last_login_at: string | null;
}

// Self-migration DDL (created on first request, see index.ts ensureSchema).
export const USERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tech',
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lockout_until TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);`;

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT * FROM users WHERE email = ?1 COLLATE NOCASE`)
    .bind(email.trim().toLowerCase())
    .first<UserRow>();
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ?1`).bind(id).first<UserRow>();
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
  return row?.n ?? 0;
}

// The authenticated user for a request, from the session JWT. Checks the token
// signature/expiry, that the user still exists and is not disabled, and that the
// token version matches (so password changes / disabling revoke old sessions).
export async function getAuthUser(request: Request, env: Env): Promise<UserRow | null> {
  if (!env.AUTH_SECRET) return null;
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const payload = await verifyJwt(token, env.AUTH_SECRET);
  if (!payload || payload.kind !== 'session' || !payload.sub) return null;

  const user = await getUserById(env.DB, String(payload.sub));
  if (!user || user.disabled) return null;
  if (Number(payload.tv) !== user.token_version) return null;
  return user;
}
