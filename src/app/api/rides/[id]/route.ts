import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { rides } from '@/db/schema';
import { loadRideExport } from '@/lib/ride-payload';

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

  // Rename is a content edit (RIDE_EDIT_WEB_HANDOFF.md): stamp
  // edited_at so a stale iOS re-upload can't clobber the new title.
  const updated = await db
    .update(rides)
    .set({ title: body.title, editedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rides.rideUuid, id), eq(rides.userId, session.user.id)))
    .returning({ rideUuid: rides.rideUuid, title: rides.title });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Re-hash from the server-canonical payload (now carrying the new
  // title + editedAt) so the iOS batch check reports a mismatch and
  // the device pulls the rename instead of skipping the ride as
  // already-synced.
  const loaded = await loadRideExport(id, session.user.id);
  if (loaded) {
    const contentHash = createHash('sha256')
      .update(JSON.stringify(loaded.payload), 'utf8')
      .digest('hex');
    await db
      .update(rides)
      .set({ contentHash })
      .where(and(eq(rides.rideUuid, id), eq(rides.userId, session.user.id)));
  }

  return NextResponse.json({ id: updated[0].rideUuid, title: updated[0].title });
}
