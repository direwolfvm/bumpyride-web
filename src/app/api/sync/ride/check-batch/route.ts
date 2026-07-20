import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { inArray, and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { rides } from '@/db/schema';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Batch sync-checksum check. One request answers a whole backfill
// drain queue instead of N sequential per-ride round-trips through
// /api/sync/ride/check. See
// bumpy-ride/docs/SYNC_BATCH_CHECK_WEB_HANDOFF.md.
//
// Response is just the list of ride ids the client must upload:
// missing on the server OR stored with a different content hash.
// Ride ids that belong to a DIFFERENT account are also included in
// `needed` — the subsequent upload surfaces the 409 exactly as it
// does today, and this endpoint never leaks whether a foreign id
// "exists".

const MAX_ENTRIES = 500;

const entrySchema = z.object({
  rideId: z
    .string()
    .uuid({ message: 'rideId must be a UUID' })
    // iOS sends uppercase per NSUUID conventions; we store lowercase
    // per pg's uuid type — normalise for the lookup. The response
    // echoes the lowercase form; iOS matches ids case-insensitively.
    .transform((s) => s.toLowerCase()),
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'hash must be 64 lowercase hex chars'),
});

const schema = z.object({
  rides: z
    .array(entrySchema)
    .max(MAX_ENTRIES, `at most ${MAX_ENTRIES} entries per request`),
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

  if (body.rides.length === 0) {
    return NextResponse.json({ needed: [] });
  }

  // Single indexed lookup over the caller's own rides. Foreign-owned
  // ids simply don't match the user_id filter, fall out of the map,
  // and land in `needed` like any missing ride.
  const ids = body.rides.map((r) => r.rideId);
  const rows = await db
    .select({ rideUuid: rides.rideUuid, contentHash: rides.contentHash })
    .from(rides)
    .where(and(eq(rides.userId, userId), inArray(rides.rideUuid, ids)));
  const hashById = new Map(rows.map((r) => [r.rideUuid, r.contentHash]));

  // Needed = missing, foreign-owned, pre-hash-column (null stored
  // hash), or hash mismatch. Dedupe in case the client repeats an id.
  const needed: string[] = [];
  const seen = new Set<string>();
  for (const entry of body.rides) {
    if (seen.has(entry.rideId)) continue;
    seen.add(entry.rideId);
    const stored = hashById.get(entry.rideId);
    if (stored === undefined || stored === null || stored !== entry.hash) {
      needed.push(entry.rideId);
    }
  }

  return NextResponse.json({ needed });
}
