import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { identifierOf } from '@/lib/identity';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bearer-authed identity probe. iOS uses this at pairing time to validate a
// freshly-pasted token and display "connected as <identifier>" — without it
// the app has to either upload a fake ride or wait for the next real ride to
// learn the token is good.
//
// `identifier` is how the account signs in and is ALWAYS present; `email`
// may be null, because an account can be identified by a username instead
// (we send no email, so an address is optional). Clients that display a
// value should prefer `identifier`.
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
    columns: { id: true, email: true, username: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }
  return NextResponse.json({ ...user, identifier: identifierOf(user) });
}
