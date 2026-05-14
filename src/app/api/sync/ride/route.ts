import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { pool } from '@/db';
import { rideSchema, type RidePayload } from '@/lib/ride-schema';
import { gridIndex } from '@/lib/bump-grid';
import { calibrationActive } from '@/lib/calibration';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

type CellDelta = { ix: number; iy: number; sumDelta: number; countDelta: number };

/**
 * Add or subtract a ride's points to the per-cell delta map.
 *
 *   sign: +1 to add the points, -1 to subtract.
 *   gain: per-bumpiness multiplier — 1.0 for mounted rides, the user's
 *         pocketGain for pocket-mode rides when their calibration is
 *         active (confidence >= 3). The gain only scales the cell sum;
 *         counts always step by ±1 regardless.
 */
function accumulateDeltas(
  deltas: Map<string, CellDelta>,
  points: { latitude: number; longitude: number; bumpiness: number }[],
  sign: 1 | -1,
  gain = 1,
) {
  for (const p of points) {
    const { ix, iy } = gridIndex(p.latitude, p.longitude);
    const key = `${ix}:${iy}`;
    const existing = deltas.get(key);
    const sumStep = sign * p.bumpiness * gain;
    if (existing) {
      existing.sumDelta += sumStep;
      existing.countDelta += sign;
    } else {
      deltas.set(key, {
        ix,
        iy,
        sumDelta: sumStep,
        countDelta: sign,
      });
    }
  }
}

function summarize(payload: RidePayload) {
  let distanceM = 0;
  let maxBumpiness = 0;
  let sumBumpiness = 0;
  for (let i = 0; i < payload.points.length; i++) {
    const p = payload.points[i];
    if (p.bumpiness > maxBumpiness) maxBumpiness = p.bumpiness;
    sumBumpiness += p.bumpiness;
    if (i > 0) {
      const prev = payload.points[i - 1];
      distanceM += haversineMeters(
        prev.latitude,
        prev.longitude,
        p.latitude,
        p.longitude,
      );
    }
  }
  const avgBumpiness =
    payload.points.length > 0 ? sumBumpiness / payload.points.length : 0;
  return { distanceM, maxBumpiness, avgBumpiness };
}

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
  const { userId, shareToPublicMap, pocketGain, pocketConfidence } =
    tokenLookup;
  // When the rider's calibration meets the confidence threshold, pocket-
  // mode samples are scaled by their pocketGain before they hit bump_cells.
  // Otherwise pocket-mode rides are excluded from the public aggregate
  // (we don't know how to convert them to mounted-equivalent).
  const userCalibrated = calibrationActive(pocketConfidence);

  let payload: RidePayload;
  try {
    const raw = await req.json();
    payload = rideSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid ride payload', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'invalid JSON' },
      { status: 400 },
    );
  }

  if (new Date(payload.endedAt) < new Date(payload.startedAt)) {
    return NextResponse.json(
      { error: 'endedAt must be >= startedAt' },
      { status: 400 },
    );
  }

  const { distanceM, maxBumpiness, avgBumpiness } = summarize(payload);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{
      ride_uuid: string;
      user_id: string;
      pocket_mode: boolean | null;
    }>(
      'SELECT ride_uuid, user_id, pocket_mode FROM rides WHERE ride_uuid = $1 FOR UPDATE',
      [payload.id],
    );
    const isUpdate = existing.rows.length > 0;
    if (isUpdate && existing.rows[0].user_id !== userId) {
      // ride_uuid is universally unique by construction (UUID v4 in the iOS
      // app), so this collision implies a replay attempt; deny rather than
      // overwrite the legitimate owner's ride.
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'ride owned by another user' },
        { status: 409 },
      );
    }

    // Public aggregate eligibility — a ride contributes to bump_cells if:
    //   - the user is opted in (shareToPublicMap), AND
    //   - the ride is mounted-mode (pocketMode === false), OR
    //     the ride is pocket-mode AND the user has calibration in effect.
    // The applied gain per pocket-mode sample is the user's pocketGain;
    // mounted-mode samples use raw bumpiness. Legacy pocket_mode = null
    // rides are always excluded from the public aggregate (we don't know
    // the sensing mode, so we can't trust the magnitude).
    const oldPocketMode = isUpdate ? existing.rows[0].pocket_mode : null;
    const newPocketMode = payload.pocketMode ?? null;
    const oldRideEligible =
      shareToPublicMap &&
      (oldPocketMode === false || (oldPocketMode === true && userCalibrated));
    const newRideEligible =
      shareToPublicMap &&
      (newPocketMode === false || (newPocketMode === true && userCalibrated));
    const wasInPublic = isUpdate && oldRideEligible;
    const willBeInPublic = newRideEligible;
    const oldGain = oldPocketMode === true ? pocketGain : 1;
    const newGain = newPocketMode === true ? pocketGain : 1;

    const deltas = new Map<string, CellDelta>();

    if (isUpdate) {
      const oldPoints = await client.query<{
        latitude: number;
        longitude: number;
        bumpiness: number;
      }>(
        'SELECT latitude, longitude, bumpiness FROM ride_points WHERE ride_uuid = $1',
        [payload.id],
      );
      if (wasInPublic) accumulateDeltas(deltas, oldPoints.rows, -1, oldGain);
      await client.query('DELETE FROM ride_points WHERE ride_uuid = $1', [
        payload.id,
      ]);
    }

    if (willBeInPublic) accumulateDeltas(deltas, payload.points, +1, newGain);

    if (isUpdate) {
      await client.query(
        `UPDATE rides SET
           title = $2,
           started_at = $3,
           ended_at = $4,
           pocket_mode = $5,
           schema_version = $6,
           point_count = $7,
           distance_m = $8,
           max_bumpiness = $9,
           avg_bumpiness = $10,
           updated_at = now()
         WHERE ride_uuid = $1`,
        [
          payload.id,
          payload.title,
          payload.startedAt,
          payload.endedAt,
          payload.pocketMode ?? null,
          payload.schemaVersion,
          payload.points.length,
          distanceM,
          maxBumpiness,
          avgBumpiness,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO rides (
           ride_uuid, user_id, title, started_at, ended_at, pocket_mode,
           schema_version, point_count, distance_m, max_bumpiness, avg_bumpiness
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          payload.id,
          userId,
          payload.title,
          payload.startedAt,
          payload.endedAt,
          payload.pocketMode ?? null,
          payload.schemaVersion,
          payload.points.length,
          distanceM,
          maxBumpiness,
          avgBumpiness,
        ],
      );
    }

    for (let i = 0; i < payload.points.length; i++) {
      const p = payload.points[i];
      await client.query(
        `INSERT INTO ride_points (
           ride_uuid, idx, point_uuid, timestamp,
           latitude, longitude, speed, bumpiness, accel_window
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          payload.id,
          i,
          p.id,
          p.timestamp,
          p.latitude,
          p.longitude,
          p.speed,
          p.bumpiness,
          p.accelWindow,
        ],
      );
    }

    // Apply bump_cells deltas. The map was built above from the
    // (wasInPublic, willBeInPublic) cases:
    //   was=T, will=T → net (new - old)         (re-sync, still eligible)
    //   was=T, will=F → -old                    (mounted → pocket, or opted out)
    //   was=F, will=T → +new                    (pocket → mounted, or opted in)
    //   was=F, will=F → empty                   (no-op)
    // so the loop below trivially handles every combination.
    //
    // The invariant we maintain:
    //   bump_cells.sum   = SUM over (ride, point) s.t.
    //                        user.share_to_public_map = TRUE
    //                        AND (ride.pocket_mode = FALSE
    //                             OR (ride.pocket_mode = TRUE
    //                                 AND user.pocket_confidence >= 3))
    //                      of bumpiness * effective_gain
    //                      where effective_gain = pocket_gain for pocket
    //                      samples (when calibration active), else 1.0.
    //   bump_cells.count = SUM over the same (ride, point) of 1.
    for (const d of deltas.values()) {
      if (d.sumDelta === 0 && d.countDelta === 0) continue;
      await client.query(
        `INSERT INTO bump_cells (ix, iy, sum, count) VALUES ($1, $2, $3, $4)
         ON CONFLICT (ix, iy) DO UPDATE
           SET sum = bump_cells.sum + EXCLUDED.sum,
               count = bump_cells.count + EXCLUDED.count`,
        [d.ix, d.iy, d.sumDelta, d.countDelta],
      );
    }
    if (deltas.size > 0) {
      // A re-upload whose new points avoid a previously-touched cell can
      // drive that cell's running count to zero; drop those rows so the
      // public map doesn't keep emitting empty cells.
      await client.query('DELETE FROM bump_cells WHERE count <= 0');
    }

    await client.query('COMMIT');

    return NextResponse.json({
      id: payload.id,
      updated: isUpdate,
      pointCount: payload.points.length,
      distanceM,
      avgBumpiness,
      maxBumpiness,
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
