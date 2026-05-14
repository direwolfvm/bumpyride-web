import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import { CONFIDENCE_FLOOR, GAIN_MAX, GAIN_MIN } from '@/lib/calibration';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-rider pocket-mode calibration.
//
// Storage: users.{pocket_gain, pocket_confidence, pocket_calibration_at}.
//
// Application: at aggregation time (not at ingest). When `pocket_confidence
// >= CONFIDENCE_FLOOR`, pocket-mode samples are scaled by `pocket_gain`
// before they contribute to bump_cells (public aggregate) or the personal
// tile sums.
//
// Both GET and PUT accept either a Bearer API token (iOS) or a web
// session cookie, matching /api/me/sharing.

const finite = z
  .number()
  .refine(Number.isFinite, { message: 'must be finite' });

const putSchema = z.object({
  pocketGain: z.number().min(GAIN_MIN).max(GAIN_MAX).pipe(finite),
  confidence: z.number().int().min(0),
  lastComputedAt: z
    .union([z.string().datetime({ offset: true }), z.null()])
    .optional(),
});

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const res = await pool.query<{
    pocket_gain: number;
    pocket_confidence: number;
    pocket_calibration_at: Date | null;
  }>(
    `SELECT pocket_gain, pocket_confidence, pocket_calibration_at
       FROM users WHERE id = $1`,
    [userId],
  );
  const row = res.rows[0];
  // The user row always exists for a valid token; even so, the spec
  // requires a shape-conformant default if it were ever missing.
  return NextResponse.json({
    pocketGain: row ? Number(row.pocket_gain) : 1.0,
    confidence: row ? Number(row.pocket_confidence) : 0,
    lastComputedAt: row?.pocket_calibration_at?.toISOString() ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const newGain = body.pocketGain;
  const newConfidence = body.confidence;
  const newAt = body.lastComputedAt ? new Date(body.lastComputedAt) : null;

  // The hard part: applying the new calibration to bump_cells.
  //
  // We compute the delta the user's pocket contributions would change
  // by under the (old gain, old confidence) → (new gain, new confidence)
  // transition, and apply it in a single CTE-driven UPDATE.
  //
  // Effective contribution of a pocket cell:
  //     active && shared → raw_sum * gain   (count = raw_count)
  //     otherwise        → 0                (count = 0)
  // where active := (confidence >= CONFIDENCE_FLOOR).
  //
  // delta_sum   = new_active*new_gain*raw_sum - old_active*old_gain*raw_sum
  // delta_count = new_active*raw_count       - old_active*raw_count
  //
  // For mounted-mode rides, nothing here matters — they always contribute
  // raw bumpiness regardless of the user's calibration. So we only need
  // to touch cells reachable from pocket-mode points.
  //
  // The transaction is short even at scale: O(pocket-mode cells for this
  // user). At our size (single-digit rides) it's milliseconds.

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query<{
      pocket_gain: number;
      pocket_confidence: number;
      share_to_public_map: boolean;
    }>(
      `SELECT pocket_gain, pocket_confidence, share_to_public_map
         FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'user not found' }, { status: 401 });
    }
    const oldGain = Number(before.rows[0].pocket_gain);
    const oldConfidence = Number(before.rows[0].pocket_confidence);
    const shared = before.rows[0].share_to_public_map;

    const oldActive = oldConfidence >= CONFIDENCE_FLOOR;
    const newActive = newConfidence >= CONFIDENCE_FLOOR;

    await client.query(
      `UPDATE users
          SET pocket_gain = $2,
              pocket_confidence = $3,
              pocket_calibration_at = $4
        WHERE id = $1`,
      [userId, newGain, newConfidence, newAt],
    );

    // Only the user's pocket-mode points are affected, and only when
    // they're sharing publicly (their data is in bump_cells in the first
    // place). The math collapses to "no-op" if both `oldActive` and
    // `newActive` are false, or if `shared` is false.
    if (shared && (oldActive || newActive)) {
      const oldEffective = oldActive ? oldGain : 0;
      const newEffective = newActive ? newGain : 0;
      const sumMultiplier = newEffective - oldEffective;
      const countDelta = (newActive ? 1 : 0) - (oldActive ? 1 : 0);

      // Two CTEs: gather the user's pocket-mode cell sums, then upsert
      // the delta. We use ON CONFLICT so cells that didn't yet exist
      // (transitioning oldActive=false → newActive=true) get inserted.
      await client.query(
        `WITH pocket_cells AS (
           SELECT
             floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
             floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
             SUM(rp.bumpiness)::float8 AS raw_sum,
             COUNT(*)::bigint          AS raw_count
           FROM ride_points rp
           JOIN rides r ON r.ride_uuid = rp.ride_uuid
           WHERE r.user_id = $1
             AND r.pocket_mode = TRUE
           GROUP BY ix, iy
         ),
         deltas AS (
           SELECT
             ix,
             iy,
             raw_sum   * $2::float8       AS sum_delta,
             raw_count * $3::bigint       AS count_delta
           FROM pocket_cells
           WHERE raw_count > 0
         )
         INSERT INTO bump_cells (ix, iy, sum, count)
           SELECT ix, iy, sum_delta, count_delta FROM deltas
         ON CONFLICT (ix, iy) DO UPDATE
           SET sum   = bump_cells.sum   + EXCLUDED.sum,
               count = bump_cells.count + EXCLUDED.count`,
        [userId, sumMultiplier, countDelta],
      );

      // A transition that subtracts can drive cells to zero; prune them
      // so the public map doesn't keep emitting empty cells.
      if (sumMultiplier < 0 || countDelta < 0) {
        await client.query('DELETE FROM bump_cells WHERE count <= 0');
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('calibration update failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({
    pocketGain: newGain,
    confidence: newConfidence,
    lastComputedAt: newAt ? newAt.toISOString() : null,
  });
}
