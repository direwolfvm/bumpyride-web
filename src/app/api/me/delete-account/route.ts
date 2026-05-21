import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { deleteUserAccount } from '@/lib/account-deletion';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Full account teardown: rides + auth + tokens + sessions all gone.
// Accepts session cookie OR bearer API token so the iOS app can call
// this from Settings → Web Account.
//
// Requires the caller to retype their own email as a confirmation
// step. A typo there fails the request rather than silently nuking
// the wrong account if a session/token is somehow cross-wired.

const schema = z.object({
  // Same semantics as /api/me/clear-data: when true AND the user is
  // sharing, their rides + per-cell contributor rows are reassigned
  // to a fresh anonymized user. The original users row is then
  // deleted (cascading through accounts, sessions, api_tokens,
  // recovery_codes). When false, full cascade-delete + bumpiness
  // subtraction.
  keepPublicContributions: z.boolean(),
  // Sanity gate. Must exactly match the caller's current email.
  confirmEmail: z.string().email().max(254),
});

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // Check the confirmation email matches. Case-insensitive on the
  // local part because most users won't remember exact casing of
  // their own address.
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, anonymizedAt: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (user.anonymizedAt) {
    // Defense in depth: an anonymized row shouldn't have a working
    // session or token, but if one slipped through, refuse rather
    // than re-anonymize.
    return NextResponse.json(
      { error: 'account already removed' },
      { status: 410 },
    );
  }
  if (
    user.email.toLowerCase() !== body.confirmEmail.trim().toLowerCase()
  ) {
    return NextResponse.json(
      { error: 'confirmEmail does not match the account email' },
      { status: 400 },
    );
  }

  try {
    const outcome = await deleteUserAccount(userId, {
      keepPublicContributions: body.keepPublicContributions,
    });
    // Clear the Auth.js session cookies on the response so the
    // browser doesn't keep a stale logged-in state. Auth.js writes
    // these names; clearing them is enough since we're using a JWT
    // strategy and the JWT is meaningless without a matching DB row.
    const res = NextResponse.json({
      ok: true,
      ridesOrphaned: outcome.ridesOrphaned,
      ridesDeleted: outcome.ridesDeleted,
    });
    for (const name of [
      'authjs.session-token',
      '__Secure-authjs.session-token',
      'next-auth.session-token',
      '__Secure-next-auth.session-token',
    ]) {
      res.cookies.delete(name);
    }
    return res;
  } catch (err) {
    console.error('delete-account failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
