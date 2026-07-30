'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Basic trim / split editor. Index-based: the sliders pick point
// indices and the server slices [startIdx, endIdx] (trim) or
// [0, atIdx-1] / [atIdx, n-1] (split). Times shown are seconds from
// the ride start, matching the bumpiness chart's x-axis, so the user
// can line the sliders up against the chart above.

function fmtT(tSec: number): string {
  const s = Math.max(0, Math.round(tSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

type SplitResult = { part2: { id: string; title: string } };

export function RideEditor({
  rideUuid,
  times,
}: {
  rideUuid: string;
  // Seconds-from-start per point, in point (idx) order.
  times: number[];
}) {
  const router = useRouter();
  const n = times.length;
  const [mode, setMode] = useState<'trim' | 'split'>('trim');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(n - 1);
  const [at, setAt] = useState(Math.floor(n / 2));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitDone, setSplitDone] = useState<SplitResult | null>(null);

  // A server-side trim shrinks `times` on router.refresh() while the
  // slider state survives the re-render — clamp so stale indices can't
  // read past the new end.
  const s = Math.min(start, n - 1);
  const en = Math.min(end, n - 1);
  const cut = Math.min(Math.max(at, 1), n - 1);

  if (n < 2) return null;

  async function apply() {
    const body =
      mode === 'trim'
        ? { op: 'trim', startIdx: s, endIdx: en }
        : { op: 'split', atIdx: cut };
    const what =
      mode === 'trim'
        ? `Trim this ride to ${en - s + 1} of its ${n} points (${fmtT(times[s])} – ${fmtT(times[en])})? Points and events outside the range are removed from the server copy.`
        : `Split this ride at ${fmtT(times[cut])}? The second half becomes a separate new ride.`;
    if (!window.confirm(`${what}\n\nYour device will pull the edited copy on its next sync.`)) {
      return;
    }
    setError(null);
    setPending(true);
    const res = await fetch(`/api/me/rides/${rideUuid}/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Edit failed');
      return;
    }
    if (mode === 'split') {
      setSplitDone((await res.json()) as SplitResult);
    } else {
      setStart(0);
      setEnd(Number.MAX_SAFE_INTEGER); // clamps to the new last index
    }
    router.refresh();
  }

  if (splitDone) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p>
          Ride split. This page now shows part 1;{' '}
          <Link
            href={`/rides/${splitDone.part2.id}`}
            className="text-accent hover:underline"
          >
            {splitDone.part2.title}
          </Link>{' '}
          holds the rest.
        </p>
      </div>
    );
  }

  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-muted hover:text-text">
        Edit ride (trim / split)
      </summary>
      <div className="space-y-4 border-t border-border p-4 text-sm">
        <div className="flex gap-2">
          {(['trim', 'split'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded border px-3 py-1.5 capitalize ${
                mode === m
                  ? 'border-accent bg-accent/10 text-text'
                  : 'border-border-strong text-text-muted hover:border-accent'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === 'trim' ? (
          <div className="space-y-3">
            <p className="text-text-muted">
              Keep points{' '}
              <span className="font-medium tabular-nums text-text">
                {fmtT(times[s])} – {fmtT(times[en])}
              </span>{' '}
              ({(en - s + 1).toLocaleString()} of {n.toLocaleString()} points).
              Everything outside the range — points, hard brakes, close calls,
              logged events — is removed.
            </p>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">
                Start · {fmtT(times[s])}
              </span>
              <input
                type="range"
                min={0}
                max={n - 1}
                value={s}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setStart(v);
                  if (v > en) setEnd(v);
                }}
                className="w-full accent-accent"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">
                End · {fmtT(times[en])}
              </span>
              <input
                type="range"
                min={0}
                max={n - 1}
                value={en}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setEnd(v);
                  if (v < s) setStart(v);
                }}
                className="w-full accent-accent"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-text-muted">
              Split at{' '}
              <span className="font-medium tabular-nums text-text">
                {fmtT(times[cut])}
              </span>
              : part 1 keeps {cut.toLocaleString()} points, part 2 becomes a new
              ride with {(n - cut).toLocaleString()} points. Every event lands in
              exactly one half.
            </p>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-text-muted">
                Split point · {fmtT(times[cut])}
              </span>
              <input
                type="range"
                min={1}
                max={n - 1}
                value={cut}
                onChange={(e) => setAt(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="rounded bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong/90 disabled:opacity-60"
          >
            {pending
              ? 'Applying…'
              : mode === 'trim'
                ? 'Trim ride'
                : 'Split ride'}
          </button>
          <span className="text-xs text-text-dim">
            Permanent on the server; your device picks up the change on next
            sync.
          </span>
          {error && <span className="text-danger">{error}</span>}
        </div>
      </div>
    </details>
  );
}
