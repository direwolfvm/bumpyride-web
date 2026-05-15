import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Disable TOTP. We require a valid web session — that's the same surface
// the user just used to land on /settings/security; if they got there
// without a session something's gone wrong upstream. The endpoint clears
// both the secret and the enabled flag. Recovery codes are left in place
// (independent mechanism).
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  await db
    .update(users)
    .set({ totpSecret: null, totpEnabled: false })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({ enabled: false });
}
