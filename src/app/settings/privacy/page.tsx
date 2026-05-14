import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { SharingToggle } from './SharingToggle';

export const dynamic = 'force-dynamic';

const MIN_PUBLIC_CELL_COUNT = Math.max(
  1,
  Number.parseInt(process.env.PUBLIC_BUMPMAP_MIN_COUNT ?? '3', 10) || 3,
);

export default async function PrivacySettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=%2Fsettings%2Fprivacy');

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { shareToPublicMap: true },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Privacy
      </h1>
      <h2 className="mt-6 text-sm font-medium uppercase tracking-wide text-text-muted">
        Contribute to the public bump map
      </h2>
      <p className="mt-2 text-text-muted">
        The{' '}
        <Link href="/map" className="text-accent hover:underline">
          public bump map
        </Link>{' '}
        aggregates pavement roughness across all consenting riders. Cells are
        20 ft squares, and we only show a cell once it has at least{' '}
        {MIN_PUBLIC_CELL_COUNT} samples — so opting in alone won&apos;t publish
        your exact route. No timestamps, no routes, no per-user attribution are
        ever in the public output.
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
      <SharingToggle initial={user?.shareToPublicMap ?? false} />
    </div>
  );
}
