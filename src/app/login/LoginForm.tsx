'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';

export function LoginForm({ next }: { next?: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const redirectTarget = next ?? '/';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const res = await signIn('credentials', {
      email: fd.get('email'),
      password: fd.get('password'),
      redirect: false,
    });
    setPending(false);
    if (!res || res.error) {
      setError('Invalid email or password.');
      return;
    }
    window.location.href = redirectTarget;
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
            autoComplete="current-password"
            className={inputCls}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent-strong/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
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
