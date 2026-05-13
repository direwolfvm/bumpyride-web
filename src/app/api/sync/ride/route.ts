import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { pool } from '@/db';
import { rideSchema, type RidePayload } from '@/lib/ride-schema';
import { gridIndex } from '@/lib/bump-grid';
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

function accumulateDeltas(
  deltas: Map<string, CellDelta>,
  points: { latitude: number; longitude: number; bumpiness: number }[],
  sign: 1 | -1,
) {
  for (const p of points) {
    const { ix, iy } = gridIndex(p.latitude, p.longitude);
    const key = `${ix}:${iy}`;
    const existing = deltas.get(key);
    if (existing) {
      existing.sumDelta += sign * p.bumpiness;
      existing.countDelta += sign;
    } else {
      deltas.set(key, {
        ix,
        iy,
        sumDelta: sign * p.bumpiness,
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
  const userId = await lookupTokenUser(bearer);
  if (!userId) {
    return NextResponse.json(
      { error: 'invalid bearer token' },
      { status: 401 },
    );
  }

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

    const existing = await client.query<{ ride_uuid: string; user_id: string }>(
      'SELECT ride_uuid, user_id FROM rides WHERE ride_uuid = $1 FOR UPDATE',
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
      accumulateDeltas(deltas, oldPoints.rows, -1);
      await client.query('DELETE FROM ride_points WHERE ride_uuid = $1', [
        payload.id,
      ]);
    }

    accumulateDeltas(deltas, payload.points, +1);

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
    // A re-upload whose new points avoid a previously-touched cell can drive
    // that cell's running count to zero; drop those rows so the public map
    // doesn't keep emitting empty cells.
    await client.query('DELETE FROM bump_cells WHERE count <= 0');

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
