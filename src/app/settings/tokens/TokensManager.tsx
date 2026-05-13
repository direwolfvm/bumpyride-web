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
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(
    null,
  );
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
    if (
      !confirm('Revoke this token? The iOS install using it will stop syncing.')
    ) {
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
        className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-text-muted">
          <span>Label</span>
          <input
            name="label"
            placeholder="e.g. iPhone 15"
            maxLength={80}
            className="rounded border border-border-strong bg-bg px-3 py-2 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent-strong/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create token'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {revealed && (
        <div className="mt-6 rounded-lg border border-accent-strong bg-accent-soft p-4">
          <p className="text-sm text-accent">
            Copy this token now — it won&apos;t be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-bg px-3 py-2 font-mono text-sm">
            {revealed.token}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(revealed.token)}
            className="mt-2 rounded border border-accent-strong px-3 py-1 text-sm text-accent hover:bg-accent-strong/20"
          >
            Copy
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="mt-6 text-text-muted">No tokens yet. Create one above.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Last used</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-t border-border first:border-t-0">
                  <td className="px-4 py-3">{t.label}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                    {t.lastUsedAt
                      ? new Date(t.lastUsedAt).toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onRevoke(t.id)}
                      className="rounded border border-danger-soft px-3 py-1 text-sm text-danger hover:bg-danger-soft/30"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
