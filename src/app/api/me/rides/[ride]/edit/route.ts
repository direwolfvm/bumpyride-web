import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { pool } from '@/db';
import { getRequestUserId } from '@/lib/request-auth';
import { loadRideExport, type RideExportPayload } from '@/lib/ride-payload';
import type { RidePayload } from '@/lib/ride-schema';
import { applyRideUpload } from '@/lib/ride-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-side ride editor: trim a ride to a contiguous slice of its
// points, or split it into two rides at a point index. Semantics
// mirror the iOS editor exactly (RIDE_EDIT_WEB_HANDOFF.md):
//
//   trim  — the ride keeps its id and is replaced in place. points
//           become the [startIdx, endIdx] slice (inclusive);
//           startedAt/endedAt move to the slice bounds; close-call /
//           other / brake events outside the new time range are
//           dropped (we filter rather than re-detect brakes — every
//           kept event's points are still in the ride, which the
//           handoff explicitly allows); healthKitWorkoutUUID is
//           cleared (device-local anyway).
//   split — part 1 keeps the id (a trim to [0, atIdx-1]); part 2 is
//           a brand-new server-generated ride id holding [atIdx, n-1]
//           with title "… (part 2)". Points partition exactly, and
//           each event lands in exactly one half (timestamp < part 2's
//           first point goes to part 1) — no double counting by
//           construction.
//
// Both operations stamp edited_at server-side and store a fresh
// content_hash (sha256 of the server-canonical payload JSON, which
// never matches a client-side raw-bytes hash) so the iOS batch check
// reports a mismatch and the device pulls the edited copy instead of
// re-uploading — and if it re-uploads anyway, the editedAt conflict
// rule in the shared ingest pipeline 409s the stale copy.
//
// Everything runs through applyRideUpload — the same pipeline as
// POST /api/sync/ride — inside one transaction, so tiles, contributor
// sets, scoring, and achievements stay consistent by construction.

const editSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('trim'),
    startIdx: z.number().int().min(0),
    endIdx: z.number().int().min(0),
  }),
  z.object({
    op: z.literal('split'),
    atIdx: z.number().int().min(1),
  }),
]);

type EventArrays = Pick<
  RideExportPayload,
  'brakeEvents' | 'closeCallEvents' | 'otherEvents'
>;

/**
 * Filter each (possibly null) event array by a timestamp predicate.
 * Null arrays stay null — "feature not supported / not processed" is
 * a per-ride fact that survives an edit untouched.
 */
function filterEvents(
  src: EventArrays,
  keep: (isoTimestamp: string) => boolean,
): EventArrays {
  return {
    brakeEvents: src.brakeEvents?.filter((e) => keep(e.timestamp)) ?? null,
    closeCallEvents:
      src.closeCallEvents?.filter((e) => keep(e.timestamp)) ?? null,
    otherEvents: src.otherEvents?.filter((e) => keep(e.timestamp)) ?? null,
  };
}

/**
 * Assemble one output ride from a slice of the source payload.
 *
 * Carry-by-default: we SPREAD the loaded payload and override only the
 * fields an edit must change. Listing fields explicitly here would make
 * this a canonicalizer with a fixed field list — the exact shape of code
 * that silently destroys additive fields (SCHEMA.md keeps adding them:
 * healthKitWorkoutUUID, category, otherEvents, editedAt). Anything
 * loadRideExport learns to return in future survives a trim/split for
 * free; only the exceptions below need touching.
 *
 * Deliberate exceptions:
 *   - startedAt/endedAt -> the slice's first/last point timestamps
 *   - healthKitWorkoutUUID -> dropped; the Apple Health workout link
 *     describes the pre-edit ride on the recording device
 *   - editedAt -> not carried; the caller stamps a fresh value
 */
function buildSlice(
  src: RideExportPayload,
  args: {
    id: string;
    title: string;
    points: RideExportPayload['points'];
    events: EventArrays;
  },
): RidePayload {
  const {
    healthKitWorkoutUUID: _clearedByEdit,
    editedAt: _restampedByCaller,
    ...carried
  } = src;
  return {
    ...carried,
    id: args.id,
    title: args.title,
    startedAt: args.points[0].timestamp,
    endedAt: args.points[args.points.length - 1].timestamp,
    points: args.points,
    ...args.events,
  };
}

function summaryOf(payload: RidePayload, r: { distanceM: number }) {
  return {
    id: payload.id,
    title: payload.title,
    pointCount: payload.points.length,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    distanceM: r.distanceM,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ride: string }> },
) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { ride: rideUuid } = await params;

  let body: z.infer<typeof editSchema>;
  try {
    body = editSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // 404 covers both "doesn't exist" and "not yours" (no enumeration).
  const loaded = await loadRideExport(rideUuid, userId);
  if (!loaded) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const src = loaded.payload;
  const n = src.points.length;

  if (body.op === 'trim') {
    if (body.startIdx > body.endIdx || body.endIdx >= n) {
      return NextResponse.json(
        { error: `invalid trim range for ${n}-point ride` },
        { status: 400 },
      );
    }
  } else if (body.atIdx >= n) {
    return NextResponse.json(
      { error: `split index must leave at least one point on each side (ride has ${n})` },
      { status: 400 },
    );
  }

  // One editedAt stamp shared by both halves of a split — they're the
  // same user action.
  const editedAt = new Date();

  const uploads: RidePayload[] = [];
  if (body.op === 'trim') {
    const points = src.points.slice(body.startIdx, body.endIdx + 1);
    const start = points[0].timestamp;
    const end = points[points.length - 1].timestamp;
    uploads.push(
      buildSlice(src, {
        id: src.id,
        title: src.title,
        points,
        events: filterEvents(src, (t) => t >= start && t <= end),
      }),
    );
  } else {
    const part2Points = src.points.slice(body.atIdx);
    // Events partition at part 2's first point: strictly-before goes
    // to part 1, at-or-after to part 2 — every event lands in exactly
    // one half even if it falls in the gap between the slices.
    const boundary = part2Points[0].timestamp;
    uploads.push(
      buildSlice(src, {
        id: src.id,
        title: src.title,
        points: src.points.slice(0, body.atIdx),
        events: filterEvents(src, (t) => t < boundary),
      }),
      buildSlice(src, {
        id: randomUUID(),
        title: `${src.title} (part 2)`,
        points: part2Points,
        events: filterEvents(src, (t) => t >= boundary),
      }),
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Optimistic concurrency: the payload above was read outside this
    // transaction. Lock the row and make sure nothing (an iOS sync,
    // another tab) replaced the ride in between.
    const check = await client.query<{ updated_at: Date }>(
      'SELECT updated_at FROM rides WHERE ride_uuid = $1 AND user_id = $2 FOR UPDATE',
      [rideUuid, userId],
    );
    if (
      check.rows.length === 0 ||
      check.rows[0].updated_at.toISOString() !== loaded.derived.updatedAt
    ) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'ride changed concurrently; reload and retry' },
        { status: 409 },
      );
    }

    const share = await client.query<{ share_to_public_map: boolean }>(
      'SELECT share_to_public_map FROM users WHERE id = $1',
      [userId],
    );
    const shareToPublicMap = share.rows[0]?.share_to_public_map ?? false;

    const results = [];
    for (const payload of uploads) {
      // Timestamps compare lexicographically only within one format —
      // these are all loadRideExport's toISOString() output, so the
      // string comparisons in the filters above are sound.
      const contentHash = createHash('sha256')
        .update(
          JSON.stringify({ ...payload, editedAt: editedAt.toISOString() }),
          'utf8',
        )
        .digest('hex');
      const result = await applyRideUpload(client, {
        payload,
        userId,
        shareToPublicMap,
        contentHash,
        editedAt,
      });
      if (!result.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json(result.body, { status: result.status });
      }
      results.push(result);
    }

    await client.query('COMMIT');

    if (body.op === 'trim') {
      return NextResponse.json({
        op: 'trim',
        editedAt: editedAt.toISOString(),
        ride: summaryOf(uploads[0], results[0]),
      });
    }
    return NextResponse.json({
      op: 'split',
      editedAt: editedAt.toISOString(),
      part1: summaryOf(uploads[0], results[0]),
      part2: summaryOf(uploads[1], results[1]),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ride edit failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  } finally {
    client.release();
  }
}
