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
    <div className="mt-6">
      <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex-1">
          <div className="font-medium">
            {enabled ? 'On — sharing my rides' : 'Off — keeping my rides private'}
          </div>
          <div className="mt-0.5 text-sm text-text-muted">
            {enabled
              ? 'Your synced rides contribute to the public bump map.'
              : 'Your synced rides stay in your account only.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTo(!enabled)}
          disabled={pending}
          aria-pressed={enabled}
          className={`min-w-[132px] rounded px-4 py-2 font-medium text-white transition disabled:cursor-wait disabled:opacity-70 ${
            enabled
              ? 'bg-success/20 text-success hover:bg-success/30'
              : 'bg-accent-strong hover:bg-accent-strong/90'
          }`}
        >
          {pending ? '…' : enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {flash && <p className="mt-3 text-sm text-success">{flash}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
