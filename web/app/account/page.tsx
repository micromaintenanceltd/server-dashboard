'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { changePassword, mfaSetup, mfaEnable, mfaDisable, setToken } from '@/lib/api';

export default function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="px-8 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Security</h1>
        <p className="text-sm text-slate-500">Manage your password and two-factor authentication.</p>
      </header>
      <div className="max-w-xl space-y-6">
        <PasswordCard />
        <MfaCard mfaEnabled={user.mfa_enabled} email={user.email} />
      </div>
    </div>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ ok: false, text: 'New passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      const r = await changePassword(current, next);
      setToken(r.token); // keep this session valid
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg({ ok: true, text: 'Password updated. Other sessions have been signed out.' });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || 'Could not update password.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Change password</h2>
      {msg && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${
            msg.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Current password" type="password" value={current} onChange={setCurrent} />
        <Field label="New password (min 10 chars)" type="password" value={next} onChange={setNext} />
        <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Update password'}
        </button>
      </form>
    </div>
  );
}

function MfaCard({ mfaEnabled, email }: { mfaEnabled: boolean; email: string }) {
  const { reload } = useAuth();
  const [phase, setPhase] = useState<'idle' | 'setup' | 'codes'>('idle');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [disablePw, setDisablePw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const r = await mfaSetup();
      setSecret(r.secret);
      const QRCode = (await import('qrcode')).default;
      setQr(await QRCode.toDataURL(r.otpauth_uri, { margin: 1, width: 200 }));
      setPhase('setup');
    } catch (err: any) {
      setError(err.message || 'Could not start MFA setup.');
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await mfaEnable(code.trim());
      setRecovery(r.recovery_codes);
      setPhase('codes');
      setCode('');
      await reload();
    } catch (err: any) {
      setError(err.message || 'Could not enable MFA.');
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mfaDisable(disablePw);
      setDisablePw('');
      await reload();
    } catch (err: any) {
      setError(err.message || 'Could not disable MFA.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Two-factor authentication</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            mfaEnabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {mfaEnabled ? 'On' : 'Off'}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {mfaEnabled ? (
        <form onSubmit={disable} className="space-y-3">
          <p className="text-sm text-slate-500">
            Your account is protected with an authenticator app. To turn it off, confirm your
            password.
          </p>
          <Field label="Password" type="password" value={disablePw} onChange={setDisablePw} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-red-200 px-4 py-1.5 text-sm font-medium text-status-offline hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? 'Disabling...' : 'Disable MFA'}
          </button>
        </form>
      ) : phase === 'idle' ? (
        <div>
          <p className="mb-3 text-sm text-slate-500">
            Add a second step at sign-in using an authenticator app (Microsoft Authenticator, Google
            Authenticator, Authy, 1Password, etc.).
          </p>
          <button
            onClick={startSetup}
            disabled={busy}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Preparing...' : 'Set up MFA'}
          </button>
        </div>
      ) : phase === 'setup' ? (
        <form onSubmit={enable} className="space-y-3">
          <p className="text-sm text-slate-500">
            Scan this with your authenticator app, then enter the 6-digit code it shows.
          </p>
          {qr && <img src={qr} alt="MFA QR code" className="rounded border border-slate-200" />}
          <div className="text-xs text-slate-500">
            Or enter this key manually: <code className="rounded bg-slate-100 px-1.5 py-0.5">{secret}</code>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="w-40 rounded-md border border-slate-300 px-3 py-2 text-center tracking-widest"
            required
          />
          <div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? 'Verifying...' : 'Verify and enable'}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            MFA is on. Save these recovery codes somewhere safe.
          </p>
          <p className="mb-3 text-xs text-slate-500">
            Each code works once if you lose your authenticator. They are shown only now.
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm">
            {recovery.map((rc) => (
              <div key={rc}>{rc}</div>
            ))}
          </div>
          <button
            onClick={() => setPhase('idle')}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        required
      />
    </label>
  );
}
