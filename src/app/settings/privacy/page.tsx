import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { SharingToggle } from './SharingToggle';

export const dynamic = 'force-dynamic';

const MIN_PUBLIC_CELL_USERS = Math.max(
  1,
  Number.parseInt(
    process.env.PUBLIC_BUMPMAP_MIN_USERS ??
      process.env.PUBLIC_BUMPMAP_MIN_COUNT ??
      '3',
    10,
  ) || 3,
);

export default async function PrivacySettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=%2Fsettings%2Fprivacy');

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { shareToPublicMap: true, publicMapEager: true },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Public sharing
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        Per-account toggle that controls whether your rides contribute to the
        public bump map. For the site-wide policy on what data we collect,
        see the <Link href="/privacy" className="text-accent hover:underline">privacy policy</Link>.
      </p>
      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-text-muted">
        Contribute to the public maps
      </h2>
      <p className="mt-2 text-text-muted">
        The{' '}
        <Link href="/map" className="text-accent hover:underline">
          public map
        </Link>{' '}
        has three layers — pavement bumpiness, hard brakes, and close
        calls — all aggregated across consenting riders on the same 20 ft
        cell grid. One toggle covers all three: opting in shares your
        eligible bumpiness samples, your iOS-detected brake events, and
        your tapped close-call markers collectively. There&apos;s no
        per-feature opt-out.
      </p>
      <p className="mt-3 text-text-muted">
        By default a cell only appears on any layer once at least{' '}
        {MIN_PUBLIC_CELL_USERS} distinct riders have contributed to it —
        so opting in alone won&apos;t publish your exact route. No
        timestamps, no routes, no per-user attribution are ever in the
        public output.
      </p>
      <p className="mt-3 text-text-muted">
        Only your <strong>mounted-mode</strong> rides contribute to the public
        aggregate. Pocket-mode rides stay in your personal view but never
        reach the public map — so the public data isn&apos;t damped by
        phone-on-body cushioning. Legacy rides recorded before the sensing
        mode was captured are treated as mounted (matching the iOS Bump
        Map&apos;s default filter).
      </p>
      <p className="mt-3 text-text-muted">
        Sharing is <strong>off by default</strong>. Toggling here doesn&apos;t
        affect your private rides view or the iOS app — only what contributes
        to the public aggregate. Toggling on backfills your eligible rides;
        toggling off removes them.
      </p>
      <p className="mt-3 text-text-muted">
        Once sharing is on, an additional <strong>eager publish</strong>{' '}
        toggle appears. With it on, your cells render immediately instead of
        waiting for {MIN_PUBLIC_CELL_USERS} riders — handy for seeding a
        region with no other contributors yet, but it makes your routes
        visible to anyone who looks. Off is the default.
      </p>
      <SharingToggle
        initialShared={user?.shareToPublicMap ?? false}
        initialEager={user?.publicMapEager ?? false}
        minUsers={MIN_PUBLIC_CELL_USERS}
      />
    </div>
  );
}
