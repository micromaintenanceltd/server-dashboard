'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  listUsers,
  createUser,
  setUserRole,
  resetUserPassword,
  setUserDisabled,
  deleteUser,
} from '@/lib/api';
import type { ManagedUser, UserRole } from '@/lib/types';
import { relativeAge } from '@/lib/format';

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await listUsers();
      setUsers(r.users);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (user && user.role !== 'admin') {
    return (
      <div className="px-8 py-6">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This page is for admins only.
        </p>
      </div>
    );
  }

  return (
    <div className="px-8 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="text-sm text-slate-500">Manage who can sign in to the dashboard and their role.</p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <AddUserForm onCreated={load} onError={setError} />

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          Accounts ({users.length})
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">MFA</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last login</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  isSelf={user?.id === u.id}
                  onChanged={load}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function AddUserForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('tech');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createUser({ email: email.trim(), role, password });
      setEmail('');
      setPassword('');
      setRole('tech');
      onCreated();
    } catch (err: any) {
      onError(err.message || 'Failed to create user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add user</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tech@micromaintenance.co.uk"
            className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Temporary password</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="min 10 characters"
            className="w-48 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="tech">Technician (read-only)</option>
            <option value="admin">Admin (full)</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? 'Adding...' : 'Add user'}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Give the person the temporary password; they can change it and set up MFA on the Security page.
      </p>
    </section>
  );
}

function UserRow({
  u,
  isSelf,
  onChanged,
  onError,
}: {
  u: ManagedUser;
  isSelf: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (err: any) {
      onError(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function toggleRole() {
    const next: UserRole = u.role === 'admin' ? 'tech' : 'admin';
    if (confirm(`Change ${u.email} to ${next}?`)) act(() => setUserRole(u.id, next));
  }
  function reset() {
    const pw = prompt(`New password for ${u.email} (min 10 chars):`);
    if (pw) act(() => resetUserPassword(u.id, pw));
  }
  function toggleDisabled() {
    act(() => setUserDisabled(u.id, !u.disabled));
  }
  function remove() {
    if (confirm(`Delete ${u.email}? This cannot be undone.`)) act(() => deleteUser(u.id));
  }

  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-4 py-2 font-medium text-slate-800">
        {u.email}
        {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
      </td>
      <td className="px-4 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            u.role === 'admin' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {u.role}
        </span>
      </td>
      <td className="px-4 py-2 text-slate-500">{u.mfa_enabled ? 'On' : 'Off'}</td>
      <td className="px-4 py-2">
        {u.disabled ? (
          <span className="text-status-offline">Disabled</span>
        ) : (
          <span className="text-status-online">Active</span>
        )}
      </td>
      <td className="px-4 py-2 text-slate-500">
        {u.last_login_at ? relativeAge(u.last_login_at) : 'never'}
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-2">
          <button onClick={toggleRole} disabled={busy} className={btn}>
            {u.role === 'admin' ? 'Make tech' : 'Make admin'}
          </button>
          <button onClick={reset} disabled={busy} className={btn}>
            Reset password
          </button>
          <button onClick={toggleDisabled} disabled={busy || isSelf} className={btn}>
            {u.disabled ? 'Enable' : 'Disable'}
          </button>
          <button
            onClick={remove}
            disabled={busy || isSelf}
            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-status-offline hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

const btn =
  'rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
