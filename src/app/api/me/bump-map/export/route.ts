import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG, CELL_SIZE_FEET, CELL_SIZE_METERS } from '@/lib/bump-grid';
import { jsonFileResponse, parseExportKind } from '@/lib/exports';
import { parseTileMode } from '@/lib/tile-mode';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Personal export of a rider's contributions to the bump map.
//
// Two kinds:
//   raw      - every individual ride_point, brake_event, and
//              close_call_event the user owns (subject to ?mode=).
//              This is the user's own data; no privacy gate, since
//              they're authenticating as themselves.
//   display  - per-cell aggregates the way the on-screen map shows
//              them: sum + count + average bumpiness per cell, plus
//              per-cell brake and close-call counts.
//
// ?mode= matches the public tile route convention: all / 3mo /
// last10. Lets the export reflect whatever view the user was looking
// at in the UI.

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const kind = parseExportKind(url.searchParams.get('kind'));
  const mode = parseTileMode(url.searchParams.get('mode'));

  // Time-window filter fragments. Reused below for each source table.
  const timeFilter = (col: string) =>
    mode === '3mo' ? `AND ${col} > now() - interval '3 months'` : '';

  try {
    if (kind === 'raw') {
      // Raw: dump the source rows. For mode=last10 we still apply the
      // per-cell windowing — "last 10 in each cell" makes sense as a
      // raw view too, since the alternative (last 10 across the whole
      // dataset) is rarely what anyone wants.
      const ridePointsSql = `
        WITH rp AS (
          SELECT
            r.ride_uuid,
            rp.idx,
            rp.point_uuid,
            rp.timestamp,
            rp.latitude,
            rp.longitude,
            rp.speed,
            rp.bumpiness,
            rp.accel_window,
            rp.horizontal_accel,
            floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
            floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy
          FROM ride_points rp
          JOIN rides r ON r.ride_uuid = rp.ride_uuid
          WHERE r.user_id = $1
            ${timeFilter('rp.timestamp')}
        )
        ${
          mode === 'last10'
            ? `, ranked AS (
                 SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
                   FROM rp
               )
               SELECT * FROM ranked WHERE rn <= 10 ORDER BY ride_uuid, idx`
            : `SELECT * FROM rp ORDER BY ride_uuid, idx`
        }
      `;
      const brakesSql = `
        ${
          mode === 'last10'
            ? `WITH e AS (
                 SELECT
                   b.ride_uuid, b.event_uuid, b.timestamp,
                   b.latitude, b.longitude,
                   b.peak_deceleration_mps2, b.duration_seconds,
                   floor(b.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
                   floor(b.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy
                 FROM brake_events b
                 JOIN rides r ON r.ride_uuid = b.ride_uuid
                 WHERE r.user_id = $1
               ), ranked AS (
                 SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn FROM e
               )
               SELECT ride_uuid, event_uuid, timestamp, latitude, longitude,
                      peak_deceleration_mps2, duration_seconds
                 FROM ranked WHERE rn <= 10 ORDER BY timestamp`
            : `SELECT b.ride_uuid, b.event_uuid, b.timestamp,
                       b.latitude, b.longitude,
                       b.peak_deceleration_mps2, b.duration_seconds
                  FROM brake_events b
                  JOIN rides r ON r.ride_uuid = b.ride_uuid
                  WHERE r.user_id = $1
                    ${timeFilter('b.timestamp')}
                  ORDER BY b.timestamp`
        }
      `;
      const closeCallsSql = `
        ${
          mode === 'last10'
            ? `WITH e AS (
                 SELECT c.ride_uuid, c.event_uuid, c.timestamp,
                        c.latitude, c.longitude,
                        floor(c.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
                        floor(c.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy
                 FROM close_call_events c
                 JOIN rides r ON r.ride_uuid = c.ride_uuid
                 WHERE r.user_id = $1
               ), ranked AS (
                 SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn FROM e
               )
               SELECT ride_uuid, event_uuid, timestamp, latitude, longitude
                 FROM ranked WHERE rn <= 10 ORDER BY timestamp`
            : `SELECT c.ride_uuid, c.event_uuid, c.timestamp,
                       c.latitude, c.longitude
                  FROM close_call_events c
                  JOIN rides r ON r.ride_uuid = c.ride_uuid
                  WHERE r.user_id = $1
                    ${timeFilter('c.timestamp')}
                  ORDER BY c.timestamp`
        }
      `;

      const [points, brakes, closeCalls] = await Promise.all([
        pool.query(ridePointsSql, [userId]),
        pool.query(brakesSql, [userId]),
        pool.query(closeCallsSql, [userId]),
      ]);

      return jsonFileResponse(
        {
          kind: 'raw',
          mode,
          generatedAt: new Date().toISOString(),
          cellSizeFeet: CELL_SIZE_FEET,
          cellSizeMeters: CELL_SIZE_METERS,
          ridePoints: points.rows.map((p) => ({
            rideUuid: p.ride_uuid,
            idx: Number(p.idx),
            id: p.point_uuid,
            timestamp: new Date(p.timestamp).toISOString(),
            latitude: Number(p.latitude),
            longitude: Number(p.longitude),
            speed: Number(p.speed),
            bumpiness: Number(p.bumpiness),
            accelWindow: p.accel_window,
            horizontalAccel:
              p.horizontal_accel == null ? null : Number(p.horizontal_accel),
            ix: Number(p.ix),
            iy: Number(p.iy),
          })),
          brakeEvents: brakes.rows.map((b) => ({
            rideUuid: b.ride_uuid,
            id: b.event_uuid,
            timestamp: new Date(b.timestamp).toISOString(),
            latitude: Number(b.latitude),
            longitude: Number(b.longitude),
            peakDecelerationMPS2: Number(b.peak_deceleration_mps2),
            durationSeconds: Number(b.duration_seconds),
          })),
          closeCallEvents: closeCalls.rows.map((c) => ({
            rideUuid: c.ride_uuid,
            id: c.event_uuid,
            timestamp: new Date(c.timestamp).toISOString(),
            latitude: Number(c.latitude),
            longitude: Number(c.longitude),
          })),
        },
        `bump-map-raw-${mode}.json`,
      );
    }

    // kind === 'display'
    // Per-cell aggregates for each of the three signals. Lat/lon
    // returned alongside the (ix, iy) indices: SW corner of the
    // cell, matching the iOS BumpGrid origin convention.
    const bumpinessSql = `
      WITH sc AS (
        SELECT
          floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
          floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
          rp.bumpiness,
          rp.timestamp
        FROM ride_points rp
        JOIN rides r ON r.ride_uuid = rp.ride_uuid
        WHERE r.user_id = $1
          ${timeFilter('rp.timestamp')}
      )
      ${
        mode === 'last10'
          ? `, ranked AS (
               SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
                 FROM sc
             )
             SELECT ix, iy,
                    sum(bumpiness)::float8 AS sum,
                    count(*)::int          AS count
               FROM ranked
              WHERE rn <= 10
              GROUP BY ix, iy`
          : `SELECT ix, iy,
                    sum(bumpiness)::float8 AS sum,
                    count(*)::int          AS count
               FROM sc
              GROUP BY ix, iy`
      }
    `;
    const countByCellSql = (table: 'brake_events' | 'close_call_events') => `
      WITH ec AS (
        SELECT
          floor(e.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
          floor(e.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
          e.timestamp
        FROM ${table} e
        JOIN rides r ON r.ride_uuid = e.ride_uuid
        WHERE r.user_id = $1
          ${timeFilter('e.timestamp')}
      )
      ${
        mode === 'last10'
          ? `, ranked AS (
               SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
                 FROM ec
             )
             SELECT ix, iy, count(*)::int AS count
               FROM ranked WHERE rn <= 10
              GROUP BY ix, iy`
          : `SELECT ix, iy, count(*)::int AS count FROM ec GROUP BY ix, iy`
      }
    `;

    const [bumps, brakes, closeCalls] = await Promise.all([
      pool.query<{ ix: number; iy: number; sum: number; count: number }>(
        bumpinessSql,
        [userId],
      ),
      pool.query<{ ix: number; iy: number; count: number }>(
        countByCellSql('brake_events'),
        [userId],
      ),
      pool.query<{ ix: number; iy: number; count: number }>(
        countByCellSql('close_call_events'),
        [userId],
      ),
    ]);

    return jsonFileResponse(
      {
        kind: 'display',
        mode,
        generatedAt: new Date().toISOString(),
        cellSizeFeet: CELL_SIZE_FEET,
        cellSizeMeters: CELL_SIZE_METERS,
        bumpiness: bumps.rows.map((c) => {
          const ix = Number(c.ix);
          const iy = Number(c.iy);
          const sum = Number(c.sum);
          const count = Number(c.count);
          return {
            ix,
            iy,
            swLatitude: iy * CELL_LAT_DEG,
            swLongitude: ix * CELL_LON_DEG,
            sum,
            count,
            avgBumpiness: count > 0 ? sum / count : 0,
          };
        }),
        brakes: brakes.rows.map((c) => {
          const ix = Number(c.ix);
          const iy = Number(c.iy);
          return {
            ix,
            iy,
            swLatitude: iy * CELL_LAT_DEG,
            swLongitude: ix * CELL_LON_DEG,
            count: Number(c.count),
          };
        }),
        closeCalls: closeCalls.rows.map((c) => {
          const ix = Number(c.ix);
          const iy = Number(c.iy);
          return {
            ix,
            iy,
            swLatitude: iy * CELL_LAT_DEG,
            swLongitude: ix * CELL_LON_DEG,
            count: Number(c.count),
          };
        }),
      },
      `bump-map-display-${mode}.json`,
    );
  } catch (err) {
    console.error('bump-map export failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
