import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { apiTokens } from '@/db/schema';
import { TokensManager } from './TokensManager';

export const dynamic = 'force-dynamic';

export default async function TokensPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const rows = await db
    .select({
      id: apiTokens.id,
      label: apiTokens.label,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, session.user.id))
    .orderBy(desc(apiTokens.createdAt));

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>iOS sync tokens</h1>
      <p style={{ color: '#9a9aac' }}>
        Each token authorises one BumpyRide iOS install to upload rides to your
        account. The plaintext is shown <strong>once</strong> at creation —
        copy it into the iOS app immediately. Revoke any token at any time.
      </p>
      <TokensManager
        initialTokens={rows.map((r) => ({
          id: r.id,
          label: r.label,
          createdAt: r.createdAt.toISOString(),
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
