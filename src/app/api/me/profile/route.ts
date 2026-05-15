import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Profile update — name only for now. Email is intentionally not editable
// here because changing it would also need to invalidate sessions /
// re-verify ownership, which we don't have plumbing for yet. The plain
// text input is trimmed; whitespace-only values clear the name to NULL.
const patchSchema = z.object({
  name: z.string().max(80),
});

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const trimmed = body.name.trim();
  const next = trimmed === '' ? null : trimmed;

  const [row] = await db
    .update(users)
    .set({ name: next })
    .where(eq(users.id, userId))
    .returning({ name: users.name });

  return NextResponse.json({ name: row?.name ?? null });
}
