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
    <div style={{ maxWidth: 720 }}>
      <h1>Privacy</h1>
      <h2 style={sectionH2}>Contribute to the public bump map</h2>
      <p style={{ color: '#9a9aac', lineHeight: 1.5 }}>
        The{' '}
        <a href="/map" style={{ color: '#9bb4ff' }}>
          public bump map
        </a>{' '}
        aggregates pavement roughness across all consenting riders. Cells are
        20 ft squares, and we only show a cell once it has at least{' '}
        {MIN_PUBLIC_CELL_COUNT} samples — so opting in alone won&apos;t
        publish your exact route. No timestamps, no routes, no per-user
        attribution are ever in the public output.
      </p>
      <p style={{ color: '#9a9aac', lineHeight: 1.5 }}>
        Sharing is <strong>off by default</strong>. Toggling here doesn&apos;t
        affect your private rides view or the iOS app — only what
        contributes to the public aggregate. Toggling on backfills your
        existing rides into the aggregate; toggling off removes them.
      </p>
      <SharingToggle initial={user?.shareToPublicMap ?? false} />
    </div>
  );
}

const sectionH2 = {
  fontSize: 18,
  margin: '1.5rem 0 0.75rem 0',
  color: '#c4c4d4',
  fontWeight: 500,
} as const;
