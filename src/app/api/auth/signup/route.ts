import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword } from '@/lib/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const signupSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80).optional(),
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

  const existing = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  });
  if (existing) {
    return NextResponse.json(
      { error: 'email already registered' },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(body.password);
  const [created] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash,
      name: body.name ?? null,
    })
    .returning({ id: users.id, email: users.email });

  return NextResponse.json({ id: created.id, email: created.email });
}
