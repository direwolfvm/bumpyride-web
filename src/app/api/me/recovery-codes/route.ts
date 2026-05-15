import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { recoveryCodes } from '@/db/schema';
import { CODES_PER_USER, generateSet } from '@/lib/recovery-codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET → status only (count remaining / total). Existing plaintext codes
// are never readable after creation.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      remaining: sql<number>`count(*) filter (where used_at is null)::int`,
    })
    .from(recoveryCodes)
    .where(eq(recoveryCodes.userId, session.user.id));
  const row = rows[0] ?? { total: 0, remaining: 0 };
  return NextResponse.json({
    total: Number(row.total),
    remaining: Number(row.remaining),
  });
}

// POST → regenerate the user's set. Wipes any existing rows (used or not)
// and inserts a fresh 8, returning the plaintext once. There is no path
// to retrieve the plaintext after this response — the user copies it now
// or they regenerate again.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;
  const set = generateSet();
  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(
      set.map(({ hash }) => ({
        userId,
        codeHash: hash,
      })),
    );
  });
  return NextResponse.json({
    codes: set.map((c) => c.plaintext),
    total: CODES_PER_USER,
    remaining: CODES_PER_USER,
  });
}

// DELETE → invalidate any remaining recovery codes (e.g. after the user
// disables TOTP and wants to clear their recovery surface). Used codes
// stay in place for audit; only unused ones get marked used.
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(eq(recoveryCodes.userId, session.user.id), isNull(recoveryCodes.usedAt)),
    );
  return NextResponse.json({ remaining: 0 });
}
