'use client';

import { useState, type FormEvent } from 'react';

type Token = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function TokensManager({ initialTokens }: { initialTokens: Token[] }) {
  const [tokens, setTokens] = useState<Token[]>(initialTokens);
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label') ?? '').trim();
    if (!label) {
      setError('Label is required.');
      setPending(false);
      return;
    }
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Failed to create token');
      return;
    }
    const created = await res.json();
    setTokens((prev) => [
      {
        id: created.id,
        label: created.label,
        createdAt: created.createdAt,
        lastUsedAt: null,
      },
      ...prev,
    ]);
    setRevealed({ id: created.id, token: created.token });
    e.currentTarget.reset();
  }

  async function onRevoke(id: string) {
    if (!confirm('Revoke this token? The iOS install using it will stop syncing.')) {
      return;
    }
    const res = await fetch(`/api/tokens?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      alert('Failed to revoke token.');
      return;
    }
    setTokens((prev) => prev.filter((t) => t.id !== id));
    if (revealed?.id === id) setRevealed(null);
  }

  return (
    <>
      <form
        onSubmit={onCreate}
        style={{
          display: 'flex',
          gap: '0.5rem',
          margin: '1.5rem 0',
          alignItems: 'flex-end',
        }}
      >
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: 14, color: '#c4c4d4' }}>Label</span>
          <input
            name="label"
            placeholder="e.g. iPhone 15"
            maxLength={80}
            style={{
              background: '#101019',
              border: '1px solid #2a2a3a',
              color: '#e8e8ee',
              padding: '0.5rem 0.75rem',
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          style={{
            background: '#3b5dff',
            color: '#fff',
            border: 'none',
            padding: '0.6rem 1rem',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {pending ? 'Creating…' : 'Create token'}
        </button>
      </form>
      {error && <p style={{ color: '#ff8080', fontSize: 14 }}>{error}</p>}

      {revealed && (
        <div
          style={{
            padding: '1rem',
            border: '1px solid #3b5dff',
            background: '#10101e',
            borderRadius: 4,
            marginBottom: '1.5rem',
          }}
        >
          <p style={{ marginTop: 0, color: '#9bb4ff', fontSize: 14 }}>
            Copy this token now — it won&apos;t be shown again.
          </p>
          <code
            style={{
              display: 'block',
              wordBreak: 'break-all',
              background: '#0b0b10',
              padding: '0.5rem 0.75rem',
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {revealed.token}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(revealed.token);
            }}
            style={{
              marginTop: '0.5rem',
              background: 'transparent',
              color: '#9bb4ff',
              border: '1px solid #3b5dff',
              padding: '0.25rem 0.75rem',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Copy
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <p style={{ color: '#9a9aac' }}>No tokens yet. Create one above.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#9a9aac' }}>
              <th style={th}>Label</th>
              <th style={th}>Created</th>
              <th style={th}>Last used</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid #22222c' }}>
                <td style={td}>{t.label}</td>
                <td style={td}>{new Date(t.createdAt).toLocaleString()}</td>
                <td style={td}>
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => onRevoke(t.id)}
                    style={{
                      background: 'transparent',
                      color: '#ff8080',
                      border: '1px solid #5a2a2a',
                      padding: '0.25rem 0.75rem',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const th = { padding: '0.5rem 0.75rem', fontWeight: 500 } as const;
const td = { padding: '0.5rem 0.75rem' } as const;
