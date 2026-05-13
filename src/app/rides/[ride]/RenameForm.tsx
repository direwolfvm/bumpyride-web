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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={editButton}
          aria-label="Rename ride"
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        autoFocus
        style={input}
      />
      <button type="submit" disabled={pending} style={primaryButton}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => {
          setTitle(initialTitle);
          setEditing(false);
          setError(null);
        }}
        style={editButton}
      >
        Cancel
      </button>
      {error && <span style={{ color: '#ff8080', fontSize: 14 }}>{error}</span>}
    </form>
  );
}

const editButton = {
  background: 'transparent',
  border: '1px solid #44445c',
  color: '#c4c4d4',
  padding: '0.25rem 0.75rem',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
} as const;

const primaryButton = {
  background: '#3b5dff',
  color: '#fff',
  border: 'none',
  padding: '0.4rem 1rem',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
} as const;

const input = {
  background: '#101019',
  border: '1px solid #2a2a3a',
  color: '#e8e8ee',
  padding: '0.4rem 0.75rem',
  borderRadius: 4,
  fontSize: 18,
  fontWeight: 600,
  minWidth: 240,
} as const;
