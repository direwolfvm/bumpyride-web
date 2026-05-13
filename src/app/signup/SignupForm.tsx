'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    // Auto-sign-in straight after creation.
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
    window.location.href = '/';
  }

  return (
    <>
      <form onSubmit={onSubmit} style={formStyle}>
        <label style={labelStyle}>
          Name (optional)
          <input name="name" type="text" autoComplete="name" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />
        </label>
        {error && <p style={errorStyle}>{error}</p>}
        <button type="submit" disabled={pending} style={primaryButton}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <div style={dividerStyle}>or</div>
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl: '/' })}
        style={secondaryButton}
      >
        Continue with Google
      </button>
    </>
  );
}

const formStyle = { display: 'flex', flexDirection: 'column', gap: '0.75rem' } as const;
const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: 14,
  color: '#c4c4d4',
} as const;
const inputStyle = {
  background: '#101019',
  border: '1px solid #2a2a3a',
  color: '#e8e8ee',
  padding: '0.5rem 0.75rem',
  borderRadius: 4,
  fontSize: 14,
} as const;
const errorStyle = { color: '#ff8080', fontSize: 14, margin: 0 } as const;
const primaryButton = {
  background: '#3b5dff',
  color: '#fff',
  border: 'none',
  padding: '0.6rem 1rem',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
} as const;
const secondaryButton = {
  background: 'transparent',
  color: '#e8e8ee',
  border: '1px solid #44445c',
  padding: '0.6rem 1rem',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
  width: '100%',
} as const;
const dividerStyle = {
  textAlign: 'center',
  margin: '1rem 0',
  color: '#6a6a7a',
  fontSize: 12,
} as const;
