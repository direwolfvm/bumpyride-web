import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { pool } from '@/db';
import { rideSchema, type RidePayload } from '@/lib/ride-schema';
import { CELL_LAT_DEG, CELL_LON_DEG, gridIndex } from '@/lib/bump-grid';
import { recomputeRideScore } from '@/lib/scoring';
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
 * `sign` is +1 to add the points, -1 to subtract. Pocket-mode rides
 * don't contribute to the public aggregate today, so there's no gain
 * multiplier here — the calibration lives in the personal-map SQL
 * (see /api/tiles/user/...) instead.
 */
function accumulateDeltas(
  deltas: Map<string, CellDelta>,
  points: { latitude: number; longitude: number; bumpiness: number }[],
  sign: 1 | -1,
) {
  for (const p of points) {
    const { ix, iy } = gridIndex(p.latitude, p.longitude);
    const key = `${ix}:${iy}`;
    const existing = deltas.get(key);
    const sumStep = sign * p.bumpiness;
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
    //   - the ride's pocket_mode is NOT TRUE (i.e. mounted OR legacy null).
    // This mirrors the iOS Bump Map's default "Mounted" filter, which
    // also buckets null with mounted (early users predating the field
    // overwhelmingly had handlebar mounts).
    //
    // Pocket-mode rides never contribute to the public aggregate today —
    // even calibrated ones. The per-rider calibration gain still applies
    // on the personal map, but the public map is calibrated-mounted-only
    // until we ship the "include calibrated pocket data" public toggle.
    // See bumpyride/docs/SCHEMA.md (legacy-null handling) and the
    // /docs/CALIBRATION.md / future-toggle notes.
    const oldPocketMode = isUpdate ? existing.rows[0].pocket_mode : null;
    const newPocketMode = payload.pocketMode ?? null;
    const oldRideEligible = shareToPublicMap && oldPocketMode !== true;
    const newRideEligible = shareToPublicMap && newPocketMode !== true;
    const wasInPublic = isUpdate && oldRideEligible;
    const willBeInPublic = newRideEligible;

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
      if (wasInPublic) accumulateDeltas(deltas, oldPoints.rows, -1);
      await client.query('DELETE FROM ride_points WHERE ride_uuid = $1', [
        payload.id,
      ]);
    }

    if (willBeInPublic) accumulateDeltas(deltas, payload.points, +1);

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
           content_hash = $11,
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
          contentHash,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO rides (
           ride_uuid, user_id, title, started_at, ended_at, pocket_mode,
           schema_version, point_count, distance_m, max_bumpiness, avg_bumpiness,
           content_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
          contentHash,
        ],
      );
    }

    for (let i = 0; i < payload.points.length; i++) {
      const p = payload.points[i];
      await client.query(
        `INSERT INTO ride_points (
           ride_uuid, idx, point_uuid, timestamp,
           latitude, longitude, speed, bumpiness, accel_window,
           horizontal_accel
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
          p.horizontalAccel ?? null,
        ],
      );
    }

    // Brake events (v3). Three states on the payload:
    //   undefined / null  -> iOS hasn't run the detector for this ride
    //                        yet. Leave whatever rows already exist
    //                        alone; flip processed only when iOS
    //                        confirms.
    //   []                -> ran, no events. Wipe any prior rows and
    //                        mark processed=true.
    //   [ ... ]           -> wipe + replace; mark processed=true.
    // The wipe is unconditional on a non-null array so a re-upload
    // that drops a previously-detected event (e.g. iOS detector tuning)
    // can shrink the set.
    if (payload.brakeEvents !== undefined && payload.brakeEvents !== null) {
      await client.query(
        'DELETE FROM brake_events WHERE ride_uuid = $1',
        [payload.id],
      );
      for (const e of payload.brakeEvents) {
        await client.query(
          `INSERT INTO brake_events (
             ride_uuid, event_uuid, timestamp,
             latitude, longitude,
             peak_deceleration_mps2, duration_seconds
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            payload.id,
            e.id,
            e.timestamp,
            e.latitude,
            e.longitude,
            e.peakDecelerationMPS2,
            e.durationSeconds,
          ],
        );
      }
      await client.query(
        'UPDATE rides SET brake_events_processed = TRUE WHERE ride_uuid = $1',
        [payload.id],
      );
    }

    // Close-call events (v3). Same wipe-and-replace pattern as brakes:
    //   undefined / null  -> ride predates the feature (or a v1.2
    //                        device is re-syncing). Leave prior rows
    //                        and the supported flag alone.
    //   []                -> feature available, user didn't tap. Wipe
    //                        any prior rows and flip supported=true.
    //   [ ... ]           -> wipe + replace; supported=true.
    // Note: unlike brakes there's no iOS-side backfill for legacy
    // rides, so the supported=false state is sticky for pre-v1.3
    // rides forever.
    if (
      payload.closeCallEvents !== undefined &&
      payload.closeCallEvents !== null
    ) {
      await client.query(
        'DELETE FROM close_call_events WHERE ride_uuid = $1',
        [payload.id],
      );
      for (const e of payload.closeCallEvents) {
        await client.query(
          `INSERT INTO close_call_events (
             ride_uuid, event_uuid, timestamp, latitude, longitude
           ) VALUES ($1, $2, $3, $4, $5)`,
          [payload.id, e.id, e.timestamp, e.latitude, e.longitude],
        );
      }
      await client.query(
        'UPDATE rides SET close_calls_supported = TRUE WHERE ride_uuid = $1',
        [payload.id],
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
    //   bump_cells.sum   = SUM of raw bumpiness over (ride, point) s.t.
    //                        user.share_to_public_map = TRUE
    //                        AND ride.pocket_mode IS DISTINCT FROM TRUE
    //                              (i.e. false or null)
    //   bump_cells.count = number of those points
    // Pocket-mode rides never contribute (calibration scaling is only
    // applied to the rider's personal map — see /api/tiles/user/...).
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

    // Maintain bump_cell_contributors — the distinct (cell, user) set
    // that drives the "3+ users have contributed" public-visibility
    // predicate. Two operations:
    //   (a) Add this user for every cell the new ride touches (if the
    //       new ride is eligible).
    //   (b) For every cell the old ride touched but the new one
    //       doesn't, remove this user IFF no other eligible ride of
    //       theirs still covers that cell.
    // Pocket-mode or sharing-off rides never appear in the deltas map
    // (accumulateDeltas is only called when eligible), so the set of
    // cells we care about is exactly what's in deltas.
    if (willBeInPublic) {
      const newCells = new Set<string>();
      for (const p of payload.points) {
        const { ix, iy } = gridIndex(p.latitude, p.longitude);
        newCells.add(`${ix}:${iy}`);
      }
      for (const key of newCells) {
        const [ix, iy] = key.split(':').map(Number);
        await client.query(
          `INSERT INTO bump_cell_contributors (ix, iy, user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [ix, iy, userId],
        );
      }
    }

    if (wasInPublic) {
      // Collect cells the old ride used to touch. We don't have the old
      // points anymore (deleted above), so reconstruct from the deltas
      // map: any cell with a negative countDelta is one the old ride
      // contributed to. Anything with a non-negative net countDelta
      // that the new ride also touches stays; anything where the new
      // ride doesn't touch (i.e. NOT in newCells when willBeInPublic,
      // or simply every cell with negative countDelta when !will) may
      // need cleanup.
      const oldCellKeys: { ix: number; iy: number }[] = [];
      if (willBeInPublic) {
        const newKeys = new Set<string>();
        for (const p of payload.points) {
          const { ix, iy } = gridIndex(p.latitude, p.longitude);
          newKeys.add(`${ix}:${iy}`);
        }
        for (const d of deltas.values()) {
          if (!newKeys.has(`${d.ix}:${d.iy}`)) {
            oldCellKeys.push({ ix: d.ix, iy: d.iy });
          }
        }
      } else {
        // Ride went from public-eligible to not: every cell it used to
        // touch is a candidate for removal.
        for (const d of deltas.values()) {
          oldCellKeys.push({ ix: d.ix, iy: d.iy });
        }
      }
      for (const { ix, iy } of oldCellKeys) {
        // Only drop this user's contributor row if no other eligible
        // ride of theirs covers the same cell. Embed CELL_*_DEG as
        // literals — matches the sharing-toggle CTE and the
        // bump-grid.ts JS-side floor math.
        await client.query(
          `DELETE FROM bump_cell_contributors
             WHERE ix = $1 AND iy = $2 AND user_id = $3
               AND NOT EXISTS (
                 SELECT 1 FROM ride_points rp
                 JOIN rides r ON r.ride_uuid = rp.ride_uuid
                 WHERE r.user_id = $3
                   AND r.pocket_mode IS DISTINCT FROM TRUE
                   AND floor(rp.longitude / ${CELL_LON_DEG}::float8)::int = $1
                   AND floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int = $2
               )`,
          [ix, iy, userId],
        );
      }
    }

    // Cell-discovery scoring. Idempotent on re-upload — wipes this
    // ride's score_events first, then assigns tiers against the
    // current state. Eligibility matches the public-aggregate rule.
    {
      const cellsForScoring: { ix: number; iy: number }[] = [];
      if (willBeInPublic) {
        const seen = new Set<string>();
        for (const p of payload.points) {
          const { ix, iy } = gridIndex(p.latitude, p.longitude);
          const key = `${ix}:${iy}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cellsForScoring.push({ ix, iy });
        }
      }
      await recomputeRideScore(
        client,
        payload.id,
        userId,
        cellsForScoring,
        willBeInPublic,
        new Date(payload.startedAt),
      );
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
