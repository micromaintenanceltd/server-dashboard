'use client';

import { useState } from 'react';
import { login, mfaVerify, setToken } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

export default function LoginPage() {
  const { reload } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(email.trim(), password);
      if (r.mfa_required && r.mfa_token) {
        setMfaToken(r.mfa_token);
      } else if (r.token) {
        setToken(r.token);
        await reload();
      } else {
        setError('Unexpected response from server.');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      const r = await mfaVerify(mfaToken, code.trim());
      if (r.token) {
        setToken(r.token);
        await reload();
      } else {
        setError('Unexpected response from server.');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">
            MML
          </div>
          <div className="text-center">
            <div className="font-semibold text-slate-900">Server Dashboard</div>
            <div className="text-xs text-slate-500">Micro Maintenance</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!mfaToken ? (
            <form onSubmit={submitPassword} className="space-y-4">
              <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              <h1 className="text-lg font-semibold text-slate-900">Two-factor code</h1>
              <p className="text-sm text-slate-500">
                Enter the 6-digit code from your authenticator app (or a recovery code).
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-widest"
                required
                autoFocus
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? 'Verifying...' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMfaToken(null);
                  setCode('');
                  setError(null);
                }}
                className="w-full text-center text-xs text-slate-500 hover:underline"
              >
                Back
              </button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">
          Access is restricted to authorised MML staff.
        </p>
      </div>
    </div>
  );
}
