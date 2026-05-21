'use client';

import { useState, type FormEvent } from 'react';

// Two destructive operations gated behind confirmation modals.
//
//   Clear all my data   POST /api/me/clear-data
//   Delete my account   POST /api/me/delete-account
//
// When the user is currently sharing to the public maps, both modals
// surface a radio choice: drop the public-map contributions entirely,
// or keep them under a fresh anonymous identity (no link back to the
// account). When sharing is off, the choice is hidden — there's
// nothing on the public maps to preserve.
//
// Delete-account additionally requires retyping the user's email so a
// stray click can't nuke the wrong account.

const dangerCls =
  'rounded border border-danger-soft px-4 py-2 text-sm text-danger hover:bg-danger-soft/30 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryCls =
  'rounded border border-border-strong px-4 py-2 text-sm text-text hover:border-accent disabled:cursor-not-allowed disabled:opacity-60';
const primaryDangerCls =
  'rounded bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60';
const fieldCls =
  'rounded border border-border-strong bg-bg px-3 py-2 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

type ModalMode = 'clear' | 'delete' | null;

export function DangerZone({
  email,
  isSharing,
}: {
  email: string;
  isSharing: boolean;
}) {
  const [modal, setModal] = useState<ModalMode>(null);

  return (
    <>
      <section className="mt-6 rounded-lg border border-danger-soft bg-surface p-5">
        <h2 className="text-base font-medium text-danger">Danger zone</h2>
        <p className="mt-1 text-sm text-text-muted">
          Both options are permanent. Web edits and iOS sync share the
          same database — clearing data here also removes it from your
          iPhone&apos;s synced view (the local recordings on your phone
          stay until you delete them in the app).
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Row
            title="Clear all my data"
            desc="Drops every ride from your account. Your sign-in, API tokens, and recovery codes stay; you can keep using the app and record new rides."
            cta="Clear data"
            onClick={() => setModal('clear')}
          />
          <Row
            title="Delete my account"
            desc="Drops every ride and removes the account itself — email, password, API tokens, recovery codes, the lot. You'll be signed out."
            cta="Delete account"
            onClick={() => setModal('delete')}
          />
        </div>
      </section>

      {modal === 'clear' && (
        <ConfirmModal
          mode="clear"
          email={email}
          isSharing={isSharing}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'delete' && (
        <ConfirmModal
          mode="delete"
          email={email}
          isSharing={isSharing}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function Row({
  title,
  desc,
  cta,
  onClick,
}: {
  title: string;
  desc: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-bg p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <p className="mt-1 text-sm text-text-muted">{desc}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={`${dangerCls} shrink-0`}
      >
        {cta}
      </button>
    </div>
  );
}

function ConfirmModal({
  mode,
  email,
  isSharing,
  onClose,
}: {
  mode: 'clear' | 'delete';
  email: string;
  isSharing: boolean;
  onClose: () => void;
}) {
  // Default to the safer-for-the-public option ("keep") when the user
  // is sharing — most people opted in because they wanted to
  // contribute, and dropping is destructive to the wider data set.
  const [keep, setKeep] = useState(isSharing);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDelete = mode === 'delete';
  const title = isDelete ? 'Delete my account' : 'Clear all my data';
  const finalCtaLabel = isDelete ? 'Delete account' : 'Clear data';
  const endpoint = isDelete ? '/api/me/delete-account' : '/api/me/clear-data';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const body: Record<string, unknown> = { keepPublicContributions: keep };
    if (isDelete) body.confirmEmail = confirmEmail.trim();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setPending(false);
      setError(b.error ?? 'Operation failed.');
      return;
    }
    if (isDelete) {
      // Account is gone — bounce to the home page (anonymous view).
      window.location.href = '/';
    } else {
      // Rides cleared — refresh so the rides list etc. shows empty.
      window.location.reload();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="danger-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-xl">
        <h3
          id="danger-modal-title"
          className="text-lg font-semibold text-danger"
        >
          {title}
        </h3>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4 text-sm">
          {isSharing ? (
            <fieldset className="rounded border border-border-strong p-3">
              <legend className="px-1 text-xs uppercase tracking-wide text-text-muted">
                Public-map contributions
              </legend>
              <p className="text-text-muted">
                You currently share rides to the public maps. Choose
                what should happen to those contributions:
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="keep"
                    className="mt-1"
                    checked={keep}
                    onChange={() => setKeep(true)}
                  />
                  <span>
                    <strong>Keep my contributions</strong> on the
                    public maps, unlinked from my account. Bumpiness
                    averages, brake events, and close-call markers stay
                    where they are; they get reassigned to a fresh
                    anonymous identity with no link back to me.
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="keep"
                    className="mt-1"
                    checked={!keep}
                    onChange={() => setKeep(false)}
                  />
                  <span>
                    <strong>Remove my contributions</strong> from the
                    public maps. Cells my rides reinforced will lose
                    those samples; cells where I was one of only a few
                    contributors may drop below the 3-rider visibility
                    threshold.
                  </span>
                </label>
              </div>
            </fieldset>
          ) : (
            <p className="text-text-muted">
              You aren&apos;t currently sharing to the public maps, so
              there&apos;s nothing to preserve there.
            </p>
          )}

          {isDelete && (
            <label className="flex flex-col gap-1">
              <span className="text-text-muted">
                Type <strong>{email}</strong> to confirm. This step is
                not recoverable.
              </span>
              <input
                type="email"
                required
                autoComplete="off"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                className={fieldCls}
              />
            </label>
          )}

          {error && <p className="text-danger">{error}</p>}

          <div className="mt-1 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className={secondaryCls}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                pending ||
                (isDelete &&
                  confirmEmail.trim().toLowerCase() !== email.toLowerCase())
              }
              className={primaryDangerCls}
            >
              {pending ? 'Working…' : finalCtaLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
