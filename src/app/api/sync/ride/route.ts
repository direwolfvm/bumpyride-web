import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { pool } from '@/db';
import { rideSchema, type RidePayload } from '@/lib/ride-schema';
import { applyRideUpload, clampEditedAt } from '@/lib/ride-ingest';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Thin wrapper around the shared ingest pipeline — auth, raw-body
// hashing, and payload validation live here; every DB invariant
// (bump_cells deltas, contributors, events, scoring, achievements,
// and the editedAt conflict rule) lives in lib/ride-ingest.ts, which
// the web ride editor shares.

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
  const { userId, shareToPublicMap } = tokenLookup;

  // Read the raw body first so we can hash the exact bytes iOS sent
  // (matches what the /api/sync/ride/check endpoint will receive
  // from the client — re-serialising via JSON.parse/stringify would
  // change key order, whitespace, or float repr and break the check).
  let rawBody: string;
  let payload: RidePayload;
  try {
    rawBody = await req.text();
    payload = rideSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid ride payload', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const contentHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');

  if (new Date(payload.endedAt) < new Date(payload.startedAt)) {
    return NextResponse.json(
      { error: 'endedAt must be >= startedAt' },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await applyRideUpload(client, {
      payload,
      userId,
      shareToPublicMap,
      contentHash,
      editedAt: clampEditedAt(payload.editedAt),
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      return NextResponse.json(result.body, { status: result.status });
    }

    await client.query('COMMIT');

    return NextResponse.json({
      id: payload.id,
      updated: result.isUpdate,
      pointCount: payload.points.length,
      distanceM: result.distanceM,
      avgBumpiness: result.avgBumpiness,
      maxBumpiness: result.maxBumpiness,
      achievementsAwarded: result.achievementsAwarded,
      // The hash we actually stored for this ride, so the client can
      // compare it against its own and — more usefully — adopt it as
      // the value to send to /check and /check-batch. Without this the
      // two sides can disagree indefinitely with no way to notice:
      // see SYNC_BATCH_CHECK_WEB_HANDOFF.md's 2026-09-16 field report,
      // where every ride reported `needed` for six weeks because the
      // client's hash never matched the stored one and neither side
      // could see the other's value.
      contentHash,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ride sync failed', err);
    return NextResponse.json(
      { error: 'internal error' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
