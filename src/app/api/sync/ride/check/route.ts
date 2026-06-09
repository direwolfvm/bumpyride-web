import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { rides } from '@/db/schema';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sync-checksum check endpoint. Lets iOS skip re-uploading backfill
// rides the server already has byte-for-byte.
// See bumpyride/docs/SYNC_CHECKSUM_WEB_HANDOFF.md.
//
// Bearer auth (matches /api/sync/ride). Body is just the ride id +
// the SHA-256 of the JSON wire bytes the client *would* upload. We
// look up the stored content_hash and answer with a yes/no — never
// any payload, never a 404, never a hint about whether a particular
// ID is "real" but belongs to someone else.

const schema = z.object({
  rideId: z
    .string()
    .uuid({ message: 'rideId must be a UUID' })
    // iOS sends uppercase per Apple's NSUUID conventions; we store
    // lowercase per pg's uuid type — normalise for the lookup.
    .transform((s) => s.toLowerCase()),
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'hash must be 64 lowercase hex chars'),
});

export async function POST(req: NextRequest) {
  const bearer = parseBearer(req.headers.get('authorization'));
  if (!bearer) {
    return NextResponse.json(
      { error: 'missing bearer token' },
      { status: 401 },
    );
  }
  const tokenLookup = await lookupTokenUser(bearer);
  if (!tokenLookup) {
    return NextResponse.json(
      { error: 'invalid bearer token' },
      { status: 401 },
    );
  }
  const { userId } = tokenLookup;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid request', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // Look up by (rideId, userId) so a stranger's ride id is reported
  // as exists:false rather than leaking ownership info.
  const row = await db.query.rides.findFirst({
    where: and(eq(rides.rideUuid, body.rideId), eq(rides.userId, userId)),
    columns: { contentHash: true },
  });

  if (!row) {
    return NextResponse.json({ exists: false, hashMatches: false });
  }

  // Rides synced before the content_hash column existed have null
  // here. Per the handoff, report exists:true but hashMatches:false
  // so iOS uploads normally and the hash back-fills.
  const hashMatches = row.contentHash !== null && row.contentHash === body.hash;
  return NextResponse.json({ exists: true, hashMatches });
}
