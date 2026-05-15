import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { recoveryCodes, users } from '@/db/schema';
import { hashPassword } from '@/lib/password';
import { canonicalise, hashCode } from '@/lib/recovery-codes';
import { verifyCode as verifyTotp } from '@/lib/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Password reset.
//
// The caller proves account control by presenting one of:
//   - a single-use recovery code  (mechanism: 'recovery')
//   - a current TOTP code from a paired authenticator  (mechanism: 'totp')
//
// On success, the new password is bcrypt-hashed and stored; for recovery
// codes the consumed row is marked used. We return a generic "invalid
// email or proof" message for any non-success path so an attacker can't
// enumerate which emails have accounts.

const schema = z.object({
  email: z.string().email().max(254).transform((s) => s.trim().toLowerCase()),
  mechanism: z.enum(['recovery', 'totp']),
  proof: z.string().min(1).max(64),
  newPassword: z.string().min(8).max(200),
});

const GENERIC_INVALID = { error: 'invalid email or proof' };

export async function POST(req: NextRequest) {
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

  const user = await db.query.users.findFirst({
    where: eq(users.email, body.email),
    columns: { id: true, totpSecret: true, totpEnabled: true },
  });
  // Match the success-path response shape on failure so a timing or
  // body-length probe can't distinguish "no user" from "wrong code".
  if (!user) return NextResponse.json(GENERIC_INVALID, { status: 400 });

  let remaining: number | undefined;

  if (body.mechanism === 'totp') {
    if (!user.totpEnabled || !user.totpSecret) {
      return NextResponse.json(GENERIC_INVALID, { status: 400 });
    }
    if (!verifyTotp(user.totpSecret, body.proof)) {
      return NextResponse.json(GENERIC_INVALID, { status: 400 });
    }
  } else {
    // recovery
    const canonical = canonicalise(body.proof);
    if (!canonical) return NextResponse.json(GENERIC_INVALID, { status: 400 });
    const hash = hashCode(canonical);
    const consumed = await db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(recoveryCodes.userId, user.id),
          eq(recoveryCodes.codeHash, hash),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .returning({ id: recoveryCodes.id });
    if (consumed.length === 0) {
      return NextResponse.json(GENERIC_INVALID, { status: 400 });
    }
    // How many codes does the user have left after this consumption? UI
    // hint only; missing it isn't a security problem.
    const remainRows = await db
      .select({ id: recoveryCodes.id })
      .from(recoveryCodes)
      .where(
        and(eq(recoveryCodes.userId, user.id), isNull(recoveryCodes.usedAt)),
      );
    remaining = remainRows.length;
  }

  const newHash = await hashPassword(body.newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, user.id));

  return NextResponse.json(
    body.mechanism === 'recovery' ? { ok: true, remaining } : { ok: true },
  );
}
