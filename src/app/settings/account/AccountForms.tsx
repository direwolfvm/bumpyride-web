'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const fieldCls =
  'rounded border border-border-strong bg-bg px-3 py-2 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
const labelCls = 'flex flex-col gap-1 text-sm text-text-muted';
const primaryCls =
  'rounded bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong/90 disabled:cursor-not-allowed disabled:opacity-60';
const successCls = 'text-sm text-success';
const errorCls = 'text-sm text-danger';

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFlash(null);
    setPending(true);
    const res = await fetch('/api/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Update failed.');
      return;
    }
    setFlash('Saved.');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className={labelCls}>
        Name (optional)
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoComplete="name"
          className={fieldCls}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryCls}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {flash && <span className={successCls}>{flash}</span>}
        {error && <span className={errorCls}>{error}</span>}
      </div>
    </form>
  );
}

export function PasswordForm({ requireCurrent }: { requireCurrent: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFlash(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const newPassword = String(fd.get('newPassword') ?? '');
    const confirmPassword = String(fd.get('confirmPassword') ?? '');
    if (newPassword !== confirmPassword) {
      setError('Passwords don’t match.');
      setPending(false);
      return;
    }
    const body: Record<string, string> = { newPassword };
    if (requireCurrent) {
      body.currentPassword = String(fd.get('currentPassword') ?? '');
    }
    const res = await fetch('/api/me/password', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'Update failed.');
      return;
    }
    setFlash(requireCurrent ? 'Password changed.' : 'Password set.');
    e.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {requireCurrent && (
        <label className={labelCls}>
          Current password
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className={fieldCls}
          />
        </label>
      )}
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
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryCls}>
          {pending ? 'Saving…' : requireCurrent ? 'Change password' : 'Set password'}
        </button>
        {flash && <span className={successCls}>{flash}</span>}
        {error && <span className={errorCls}>{error}</span>}
      </div>
    </form>
  );
}
