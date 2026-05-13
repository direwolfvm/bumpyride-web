import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bearer-authed identity probe. iOS uses this at pairing time to validate a
// freshly-pasted token and display "connected as <email>" — without it the
// app has to either upload a fake ride or wait for the next real ride to
// learn the token is good.
export async function GET(req: NextRequest) {
  const bearer = parseBearer(req.headers.get('authorization'));
  if (!bearer) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }
  const tokenLookup = await lookupTokenUser(bearer);
  if (!tokenLookup) {
    return NextResponse.json({ error: 'invalid bearer token' }, { status: 401 });
  }
  const user = await db.query.users.findFirst({
    where: eq(users.id, tokenLookup.userId),
    columns: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }
  return NextResponse.json(user);
}
