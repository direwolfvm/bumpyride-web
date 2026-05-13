'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function RenameForm({
  rideUuid,
  initialTitle,
}: {
  rideUuid: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await fetch(`/api/rides/${rideUuid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Save failed');
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded border border-border-strong px-3 py-1 text-sm text-text-muted hover:border-accent hover:text-text"
          aria-label="Rename ride"
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        autoFocus
        className="min-w-[240px] flex-1 rounded border border-border-strong bg-bg px-3 py-2 text-2xl font-semibold tracking-tight outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:text-3xl"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong/90 disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => {
          setTitle(initialTitle);
          setEditing(false);
          setError(null);
        }}
        className="rounded border border-border-strong px-4 py-2 text-sm text-text-muted hover:border-accent"
      >
        Cancel
      </button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </form>
  );
}
