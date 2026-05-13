import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { rides } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { id } = await params;

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

  const updated = await db
    .update(rides)
    .set({ title: body.title, updatedAt: new Date() })
    .where(and(eq(rides.rideUuid, id), eq(rides.userId, session.user.id)))
    .returning({ rideUuid: rides.rideUuid, title: rides.title });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ id: updated[0].rideUuid, title: updated[0].title });
}
