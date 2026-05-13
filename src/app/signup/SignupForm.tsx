'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';

export function SignupForm({ next }: { next?: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const redirectTarget = next ?? '/';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '');
    const password = String(fd.get('password') ?? '');
    const name = String(fd.get('name') ?? '').trim() || undefined;

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Signup failed');
      setPending(false);
      return;
    }
    const signin = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });
    setPending(false);
    if (!signin || signin.error) {
      setError('Account created but sign-in failed. Try the login page.');
      return;
    }
    window.location.href = redirectTarget;
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="Name (optional)">
          <input name="name" type="text" autoComplete="name" className={inputCls} />
        </Field>
        <Field label="Email">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputCls}
          />
        </Field>
        <Field label="Password">
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputCls}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent-strong/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <div className="my-4 flex items-center gap-3 text-xs text-text-dim">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl: redirectTarget })}
        className="w-full rounded border border-border-strong px-4 py-2 hover:border-accent"
      >
        Continue with Google
      </button>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-text-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'rounded border border-border-strong bg-bg px-3 py-2 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
