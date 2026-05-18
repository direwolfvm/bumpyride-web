'use client';

import { useState } from 'react';

export function SharingToggle({
  initialShared,
  initialEager,
  minUsers,
}: {
  initialShared: boolean;
  initialEager: boolean;
  minUsers: number;
}) {
  const [shared, setShared] = useState(initialShared);
  const [eager, setEager] = useState(initialEager);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function patch(body: {
    shareToPublicMap?: boolean;
    publicMapEager?: boolean;
  }) {
    if (pending) return;
    setError(null);
    setFlash(null);
    setPending(true);
    const res = await fetch('/api/me/sharing', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? 'Update failed');
      return null;
    }
    const j = (await res.json()) as {
      shareToPublicMap: boolean;
      publicMapEager: boolean;
      changed: boolean;
    };
    setShared(j.shareToPublicMap);
    setEager(j.publicMapEager);
    return j;
  }

  async function toggleShared() {
    const next = !shared;
    const j = await patch({ shareToPublicMap: next });
    if (!j) return;
    setFlash(
      !j.changed
        ? 'No change.'
        : j.shareToPublicMap
          ? `On. Your existing rides have been added to the public aggregate. Cells stay hidden until ${minUsers} riders contribute.`
          : 'Off. Your contributions have been removed from the public aggregate.',
    );
  }

  async function toggleEager() {
    const next = !eager;
    const j = await patch({ publicMapEager: next });
    if (!j) return;
    setFlash(
      !j.changed
        ? 'No change.'
        : j.publicMapEager
          ? 'Eager publish on. Your cells will appear in the public map right away.'
          : `Eager publish off. Your cells stay hidden until ${minUsers} riders contribute to them.`,
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex-1">
          <div className="font-medium">
            {shared ? 'On — sharing my rides' : 'Off — keeping my rides private'}
          </div>
          <div className="mt-0.5 text-sm text-text-muted">
            {shared
              ? 'Your synced rides contribute to the public bump map.'
              : 'Your synced rides stay in your account only.'}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleShared}
          disabled={pending}
          aria-pressed={shared}
          className={`min-w-[132px] rounded px-4 py-2 font-medium text-white transition disabled:cursor-wait disabled:opacity-70 ${
            shared
              ? 'bg-success/20 text-success hover:bg-success/30'
              : 'bg-accent-strong hover:bg-accent-strong/90'
          }`}
        >
          {pending ? '…' : shared ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {shared && (
        <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex-1">
            <div className="font-medium">
              {eager
                ? 'Eager publish — show my cells immediately'
                : `Wait for ${minUsers} riders before showing my cells`}
            </div>
            <div className="mt-0.5 text-sm text-text-muted">
              {eager
                ? "Cells you've contributed to show up on the public map right away, even if no one else has ridden them. Useful for seeding a new region — but a careful observer could infer your routes."
                : `A cell only appears on the public map once at least ${minUsers} different riders have contributed to it. This is the safer default.`}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleEager}
            disabled={pending}
            aria-pressed={eager}
            className={`min-w-[132px] rounded px-4 py-2 font-medium text-white transition disabled:cursor-wait disabled:opacity-70 ${
              eager
                ? 'bg-success/20 text-success hover:bg-success/30'
                : 'bg-accent-strong hover:bg-accent-strong/90'
            }`}
          >
            {pending ? '…' : eager ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      )}

      {flash && <p className="mt-3 text-sm text-success">{flash}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
