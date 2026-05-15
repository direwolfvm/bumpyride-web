import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/password';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Password change / set. Accepts either a web session cookie or a Bearer
// API token. The auth flavour determines whether we require the current
// password:
//
//   Bearer (iOS)                  → no currentPassword
//       The token itself proves account control — it was minted via
//       /ios-pair (which required a fresh web sign-in) or pasted from
//       /settings/tokens (issued from an already-signed-in browser).
//       This is the "iOS as a reset credential" path.
//
//   Session, no existing password → no currentPassword
//       User signed up via Google. Setting a password for the first
//       time doesn't require one.
//
//   Session, has existing password → require currentPassword
//       Standard "change password" UX. Defends against session-only
//       attackers and meets the user's reasonable expectation.

const schema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8).max(200),
});

export async function PATCH(req: NextRequest) {
  const parseRes = await parseBody(req);
  if ('error' in parseRes) return parseRes.error;
  const { newPassword, currentPassword } = parseRes.body;

  // Identify the user and which auth flavour they used.
  const bearer = parseBearer(req.headers.get('authorization'));
  let userId: string | null = null;
  let viaBearer = false;
  if (bearer) {
    const lookup = await lookupTokenUser(bearer);
    if (!lookup) {
      return NextResponse.json({ error: 'invalid bearer token' }, { status: 401 });
    }
    userId = lookup.userId;
    viaBearer = true;
  } else {
    const session = await auth();
    userId = session?.user?.id ?? null;
  }
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { passwordHash: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const hasExistingPassword = existing.passwordHash != null;

  // Apply the rule table above.
  if (!viaBearer && hasExistingPassword) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: 'currentPassword required' },
        { status: 400 },
      );
    }
    const ok = await verifyPassword(currentPassword, existing.passwordHash!);
    if (!ok) {
      return NextResponse.json(
        { error: 'currentPassword incorrect' },
        { status: 400 },
      );
    }
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, userId));

  return NextResponse.json({ ok: true });
}

async function parseBody(
  req: NextRequest,
): Promise<{ body: z.infer<typeof schema> } | { error: NextResponse }> {
  try {
    return { body: schema.parse(await req.json()) };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        error: NextResponse.json(
          { error: 'invalid input', issues: err.issues },
          { status: 400 },
        ),
      };
    }
    return {
      error: NextResponse.json({ error: 'invalid JSON' }, { status: 400 }),
    };
  }
}
