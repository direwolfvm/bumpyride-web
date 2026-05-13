'use client';

import { useState } from 'react';

export function SharingToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function setTo(next: boolean) {
    if (pending) return;
    setError(null);
    setFlash(null);
    setPending(true);
    const res = await fetch('/api/me/sharing', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shareToPublicMap: next }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Update failed');
      return;
    }
    const json = await res.json();
    setEnabled(json.shareToPublicMap);
    setFlash(
      json.changed
        ? json.shareToPublicMap
          ? 'On. Your existing rides have been added to the public aggregate.'
          : 'Off. Your contributions have been removed from the public aggregate.'
        : 'No change.',
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '1rem',
          background: '#101019',
          border: '1px solid #22222c',
          borderRadius: 6,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>
            {enabled ? 'On — sharing my rides' : 'Off — keeping my rides private'}
          </div>
          <div style={{ color: '#9a9aac', fontSize: 13 }}>
            {enabled
              ? 'Your synced rides contribute to the public bump map.'
              : 'Your synced rides stay in your account only.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTo(!enabled)}
          disabled={pending}
          style={{
            background: enabled ? '#22443a' : '#3b5dff',
            color: '#fff',
            border: 'none',
            padding: '0.6rem 1.25rem',
            borderRadius: 4,
            cursor: pending ? 'wait' : 'pointer',
            fontSize: 14,
            minWidth: 130,
          }}
        >
          {pending ? '…' : enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {flash && (
        <p style={{ color: '#80c890', fontSize: 13, marginTop: '0.75rem' }}>{flash}</p>
      )}
      {error && (
        <p style={{ color: '#ff8080', fontSize: 13, marginTop: '0.75rem' }}>{error}</p>
      )}
    </div>
  );
}
