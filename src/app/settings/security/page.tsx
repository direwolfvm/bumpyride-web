import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { recoveryCodes, users } from '@/db/schema';
import { CODES_PER_USER } from '@/lib/recovery-codes';
import { SecurityClient } from './SecurityClient';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=%2Fsettings%2Fsecurity');

  const me = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { totpEnabled: true },
  });
  const status = await db
    .select({
      total: sql<number>`count(*)::int`,
      unused: sql<number>`count(*) filter (where used_at is null)::int`,
    })
    .from(recoveryCodes)
    .where(eq(recoveryCodes.userId, session.user.id));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Security
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        Recovery options for if you forget your password. Either of these is
        enough to reset at{' '}
        <Link href="/forgot" className="text-accent hover:underline">
          /forgot
        </Link>
        ; you don&apos;t need both. (You can also reset from inside the iOS
        app if you&apos;re paired.)
      </p>

      <SecurityClient
        initialTotpEnabled={me?.totpEnabled ?? false}
        initialRecoveryStatus={{
          total: Number(status[0]?.total ?? 0),
          remaining: Number(status[0]?.unused ?? 0),
          intended: CODES_PER_USER,
        }}
      />
    </div>
  );
}
