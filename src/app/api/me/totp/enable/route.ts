import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { verifyCode } from '@/lib/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string() });

// Verify the first TOTP code the user types from their authenticator app.
// On success, flip `totp_enabled = true` and the user can now use a code
// from this authenticator to reset their password at /forgot.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
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

  const me = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { totpSecret: true, totpEnabled: true },
  });
  if (!me?.totpSecret) {
    return NextResponse.json(
      { error: 'TOTP setup not started — POST /api/me/totp/setup first' },
      { status: 400 },
    );
  }
  if (!verifyCode(me.totpSecret, body.code)) {
    return NextResponse.json({ error: 'invalid code' }, { status: 400 });
  }

  await db
    .update(users)
    .set({ totpEnabled: true })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ enabled: true });
}
