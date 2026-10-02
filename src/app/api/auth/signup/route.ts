import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import {
  identifierOf,
  parseIdentifier,
  USERNAME_RULES,
  whereIdentifier,
} from '@/lib/identity';
import { hashPassword } from '@/lib/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// `identifier` is the field the form sends. `email` is still accepted as
// an alias so older clients keep working — both go through the same
// parser, which decides whether the value is an address or a username.
const signupSchema = z
  .object({
    identifier: z.string().max(254).optional(),
    email: z.string().max(254).optional(),
    password: z.string().min(8).max(200),
    name: z.string().min(1).max(80).optional(),
  })
  .refine((v) => (v.identifier ?? v.email ?? '').trim().length > 0, {
    message: 'identifier is required',
    path: ['identifier'],
  });

export async function POST(req: NextRequest) {
  let body: z.infer<typeof signupSchema>;
  try {
    body = signupSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const id = parseIdentifier(body.identifier ?? body.email ?? '');
  if (!id) {
    return NextResponse.json(
      {
        error:
          'Enter a valid email address, or a username — ' + USERNAME_RULES,
      },
      { status: 400 },
    );
  }

  const existing = await db.query.users.findFirst({
    where: whereIdentifier(id),
  });
  if (existing) {
    return NextResponse.json(
      {
        error:
          id.kind === 'email'
            ? 'email already registered'
            : 'username already taken',
      },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(body.password);
  const [created] = await db
    .insert(users)
    .values({
      // Exactly one of these is set. A username-only row has no email
      // at all, which is the point: we never had a use for it.
      email: id.kind === 'email' ? id.value : null,
      username: id.kind === 'username' ? id.value : null,
      passwordHash,
      name: body.name ?? null,
    })
    .returning({
      id: users.id,
      email: users.email,
      username: users.username,
    });

  return NextResponse.json({
    id: created.id,
    identifier: identifierOf(created),
    // Kept for older clients that read `email` from this response.
    email: created.email,
  });
}
