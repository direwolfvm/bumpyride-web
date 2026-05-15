'use client';

import { useState, type FormEvent } from 'react';

type Mechanism = 'recovery' | 'totp';

const fieldCls =
  'rounded border border-border-strong bg-bg px-3 py-2 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
const labelCls = 'flex flex-col gap-1 text-sm text-text-muted';

export function ForgotForm() {
  const [mechanism, setMechanism] = useState<Mechanism>('recovery');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ remaining?: number } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    const proof = String(fd.get('proof') ?? '').trim();
    const newPassword = String(fd.get('newPassword') ?? '');
    const confirmPassword = String(fd.get('confirmPassword') ?? '');
    if (newPassword !== confirmPassword) {
      setError('Passwords don’t match.');
      setPending(false);
      return;
    }
    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, mechanism, proof, newPassword }),
    });
    setPending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? 'Reset failed.');
      return;
    }
    const j = await res.json();
    setSuccess({ remaining: j.remaining });
  }

  if (success) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium text-success">
          Password reset. Sign in with your new password.
        </p>
        {typeof success.remaining === 'number' && (
          <p className="text-text-muted">
            You have <strong>{success.remaining}</strong> recovery code
            {success.remaining === 1 ? '' : 's'} left. Generate fresh ones at
            /settings/security if you&apos;re running low.
          </p>
        )}
        <a
          href="/login"
          className="inline-block rounded bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent-strong/90"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className={labelCls}>
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={fieldCls}
        />
      </label>

      <fieldset className="rounded border border-border-strong p-3">
        <legend className="px-1 text-xs text-text-muted">Proof</legend>
        <div role="radiogroup" className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mechanism"
              value="recovery"
              checked={mechanism === 'recovery'}
              onChange={() => setMechanism('recovery')}
            />
            Recovery code
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mechanism"
              value="totp"
              checked={mechanism === 'totp'}
              onChange={() => setMechanism('totp')}
            />
            Authenticator code
          </label>
        </div>
        <label className={`${labelCls} mt-3`}>
          {mechanism === 'recovery'
            ? 'Recovery code (e.g. XK74M-PR2QZ)'
            : '6-digit code from your authenticator app'}
          <input
            name="proof"
            required
            autoComplete={mechanism === 'totp' ? 'one-time-code' : 'off'}
            inputMode={mechanism === 'totp' ? 'numeric' : 'text'}
            className={`${fieldCls} font-mono`}
          />
        </label>
      </fieldset>

      <label className={labelCls}>
        New password
        <input
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={fieldCls}
        />
      </label>
      <label className={labelCls}>
        Confirm new password
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={fieldCls}
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent-strong/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  );
}
