'use client';

import { useState, type FormEvent } from 'react';

const fieldCls =
  'rounded border border-border-strong bg-bg px-3 py-2 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
const primaryCls =
  'rounded bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong/90 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryCls =
  'rounded border border-border-strong px-4 py-2 text-sm text-text hover:border-accent disabled:cursor-not-allowed disabled:opacity-60';
const dangerCls =
  'rounded border border-danger-soft px-4 py-2 text-sm text-danger hover:bg-danger-soft/30 disabled:cursor-not-allowed disabled:opacity-60';

type RecoveryStatus = { total: number; remaining: number; intended: number };

export function SecurityClient({
  initialTotpEnabled,
  initialRecoveryStatus,
}: {
  initialTotpEnabled: boolean;
  initialRecoveryStatus: RecoveryStatus;
}) {
  return (
    <div className="mt-8 space-y-6">
      <RecoveryCodes initial={initialRecoveryStatus} />
      <Totp initialEnabled={initialTotpEnabled} />
    </div>
  );
}

function RecoveryCodes({ initial }: { initial: RecoveryStatus }) {
  const [status, setStatus] = useState(initial);
  const [revealed, setRevealed] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (status.remaining > 0) {
      const ok = confirm(
        'You already have unused recovery codes. Generating new codes will invalidate the existing set. Continue?',
      );
      if (!ok) return;
    }
    setError(null);
    setPending(true);
    const res = await fetch('/api/me/recovery-codes', { method: 'POST' });
    setPending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? 'Failed to generate.');
      return;
    }
    const j = await res.json();
    setRevealed(j.codes);
    setStatus({ total: j.total, remaining: j.remaining, intended: j.total });
  }

  async function invalidate() {
    if (!confirm('Mark all remaining codes as used? They can no longer be used to reset your password.')) {
      return;
    }
    setPending(true);
    const res = await fetch('/api/me/recovery-codes', { method: 'DELETE' });
    setPending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? 'Failed to invalidate.');
      return;
    }
    setStatus({ ...status, remaining: 0 });
    setRevealed(null);
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium">Recovery codes</h2>
        <span className="text-sm text-text-muted">
          {status.total === 0
            ? 'none generated'
            : `${status.remaining} of ${status.total} remaining`}
        </span>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        Single-use codes you can exchange for a new password if you forget
        yours. Save them in your password manager — they&apos;re shown
        exactly once.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className={primaryCls}
        >
          {pending
            ? '…'
            : status.total === 0
            ? 'Generate codes'
            : 'Regenerate codes'}
        </button>
        {status.remaining > 0 && (
          <button
            type="button"
            onClick={invalidate}
            disabled={pending}
            className={dangerCls}
          >
            Invalidate all
          </button>
        )}
      </div>

      {revealed && (
        <div className="mt-4 rounded-md border border-accent-strong bg-accent-soft p-4">
          <p className="text-sm text-accent">
            Copy these somewhere safe. They won&apos;t be shown again.
          </p>
          <ol className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
            {revealed.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(revealed.join('\n'))}
            className="mt-3 rounded border border-accent-strong px-3 py-1 text-xs text-accent hover:bg-accent-strong/20"
          >
            Copy all
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

function Totp({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{
    qrDataUrl: string;
    secret: string;
  } | null>(null);

  async function startSetup() {
    setError(null);
    setPending(true);
    const res = await fetch('/api/me/totp/setup', { method: 'POST' });
    setPending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? 'Failed to start setup.');
      return;
    }
    const j = await res.json();
    setSetup({ qrDataUrl: j.qrDataUrl, secret: j.secret });
  }

  async function verifyAndEnable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/me/totp/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: String(fd.get('code') ?? '') }),
    });
    setPending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? 'Invalid code.');
      return;
    }
    setEnabled(true);
    setSetup(null);
  }

  async function disable() {
    if (!confirm('Disable authenticator-app reset?')) return;
    setPending(true);
    const res = await fetch('/api/me/totp/disable', { method: 'POST' });
    setPending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? 'Failed to disable.');
      return;
    }
    setEnabled(false);
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium">Authenticator app</h2>
        <span
          className={
            enabled
              ? 'rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent'
              : 'text-sm text-text-dim'
          }
        >
          {enabled ? 'Enabled' : 'Not set up'}
        </span>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        Pair an authenticator app (1Password, Google Authenticator, Authy,
        iCloud Keychain) and use a 6-digit code to reset your password.
      </p>

      {!enabled && !setup && (
        <div className="mt-4">
          <button
            type="button"
            onClick={startSetup}
            disabled={pending}
            className={primaryCls}
          >
            {pending ? '…' : 'Set up'}
          </button>
        </div>
      )}

      {!enabled && setup && (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-border bg-bg p-4">
            <p className="text-sm text-text-muted">
              Scan this in your authenticator app, or type the code below if
              you can&apos;t scan.
            </p>
            <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={setup.qrDataUrl}
                alt="Authenticator setup QR code"
                width={192}
                height={192}
                className="rounded border border-border-strong bg-white p-1"
              />
              <div className="font-mono text-sm break-all">
                {setup.secret.match(/.{1,4}/g)?.join(' ')}
              </div>
            </div>
          </div>
          <form onSubmit={verifyAndEnable} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-text-muted">
              Enter the 6-digit code from your app
              <input
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,8}"
                className={`${fieldCls} font-mono w-40`}
              />
            </label>
            <button type="submit" disabled={pending} className={primaryCls}>
              {pending ? '…' : 'Verify & enable'}
            </button>
            <button
              type="button"
              onClick={() => setSetup(null)}
              disabled={pending}
              className={secondaryCls}
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {enabled && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={disable}
            disabled={pending}
            className={dangerCls}
          >
            Disable
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}
