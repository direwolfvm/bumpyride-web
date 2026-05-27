import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG, CELL_SIZE_FEET, CELL_SIZE_METERS } from '@/lib/bump-grid';
import {
  incidentColorBin,
  jsonFileResponse,
  parseExportKind,
} from '@/lib/exports';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public-map export. Anonymous; matches the tile routes' privacy
// posture: per-cell aggregates only (no per-event, no per-ride-point
// records), 3-distinct-rider gate applied per layer.
//
// `kind` controls how much derived data is included:
//   raw      - sum/count for bumpiness, count for incidents.
//   display  - the same numbers, plus avgBumpiness for bumpiness and
//              the binned color string for incidents — so the
//              consumer can reproduce the on-screen color without
//              re-running the bin logic.
//
// `mode` matches the tile routes (all / 3mo / last10).
//
// No bbox filter on the export — it returns the whole world's worth
// of cells. Practical limit is the data we have; if it grows large
// we can add ?bbox= later.

const MIN_PUBLIC_CELL_USERS = Math.max(
  1,
  Number.parseInt(
    process.env.PUBLIC_BUMPMAP_MIN_USERS ??
      process.env.PUBLIC_BUMPMAP_MIN_COUNT ??
      '3',
    10,
  ) || 3,
);

function bumpinessQuery(mode: TileMode): string {
  if (mode === 'all') {
    // Lifetime aggregate path: use the maintained `bump_cells` table
    // gated by the contributor set.
    return `
      SELECT bc.ix, bc.iy, bc.sum, bc.count
        FROM bump_cells bc
       WHERE EXISTS (
         SELECT 1
           FROM bump_cell_contributors bcc
           JOIN users u ON u.id = bcc.user_id
          WHERE bcc.ix = bc.ix AND bcc.iy = bc.iy
         HAVING count(*) >= $1 OR bool_or(u.public_map_eager)
       )
    `;
  }
  const filter = mode === '3mo' ? "AND rp.timestamp > now() - interval '3 months'" : '';
  if (mode === '3mo') {
    return `
      WITH sc AS (
        SELECT
          floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
          floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
          rp.bumpiness,
          r.user_id,
          u.public_map_eager
        FROM ride_points rp
        JOIN rides r ON r.ride_uuid = rp.ride_uuid
        JOIN users u ON u.id = r.user_id
        WHERE u.share_to_public_map = TRUE
          AND r.pocket_mode IS DISTINCT FROM TRUE
          ${filter}
      )
      SELECT ix, iy,
             sum(bumpiness)::float8 AS sum,
             count(*)::bigint       AS count
        FROM sc
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= $1 OR bool_or(public_map_eager)
    `;
  }
  // last10
  return `
    WITH sc AS (
      SELECT
        floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
        floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
        rp.bumpiness,
        rp.timestamp,
        r.user_id,
        u.public_map_eager
      FROM ride_points rp
      JOIN rides r ON r.ride_uuid = rp.ride_uuid
      JOIN users u ON u.id = r.user_id
      WHERE u.share_to_public_map = TRUE
        AND r.pocket_mode IS DISTINCT FROM TRUE
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
        FROM sc
    )
    SELECT ix, iy,
           sum(bumpiness)::float8 AS sum,
           count(*)::bigint       AS count
      FROM ranked
     WHERE rn <= 10
     GROUP BY ix, iy
    HAVING count(DISTINCT user_id) >= $1 OR bool_or(public_map_eager)
  `;
}

function incidentQuery(table: 'brake_events' | 'close_call_events', mode: TileMode): string {
  const alias = table === 'brake_events' ? 'b' : 'c';
  const sourceCte = (extraFilter = '') => `
    WITH ec AS (
      SELECT
        floor(${alias}.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
        floor(${alias}.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
        ${alias}.timestamp AS ts,
        r.user_id,
        u.public_map_eager
      FROM ${table} ${alias}
      JOIN rides r ON r.ride_uuid = ${alias}.ride_uuid
      JOIN users u ON u.id = r.user_id
      WHERE u.share_to_public_map = TRUE
        AND r.pocket_mode IS DISTINCT FROM TRUE
        ${extraFilter}
    )
  `;
  if (mode === '3mo') {
    return `
      ${sourceCte(`AND ${alias}.timestamp > now() - interval '3 months'`)}
      SELECT ix, iy, count(*)::int AS count
        FROM ec
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= $1 OR bool_or(public_map_eager)
    `;
  }
  if (mode === 'last10') {
    return `
      ${sourceCte()}
      , ranked AS (
        SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY ts DESC) AS rn FROM ec
      )
      SELECT ix, iy, count(*)::int AS count
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= $1 OR bool_or(public_map_eager)
    `;
  }
  return `
    ${sourceCte()}
    SELECT ix, iy, count(*)::int AS count
      FROM ec
     GROUP BY ix, iy
    HAVING count(DISTINCT user_id) >= $1 OR bool_or(public_map_eager)
  `;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const kind = parseExportKind(url.searchParams.get('kind'));
  const mode = parseTileMode(url.searchParams.get('mode'));

  try {
    const [bumps, brakes, closeCalls] = await Promise.all([
      pool.query<{ ix: number; iy: number; sum: number; count: number }>(
        bumpinessQuery(mode),
        [MIN_PUBLIC_CELL_USERS],
      ),
      pool.query<{ ix: number; iy: number; count: number }>(
        incidentQuery('brake_events', mode),
        [MIN_PUBLIC_CELL_USERS],
      ),
      pool.query<{ ix: number; iy: number; count: number }>(
        incidentQuery('close_call_events', mode),
        [MIN_PUBLIC_CELL_USERS],
      ),
    ]);

    const cellLatLon = (ix: number, iy: number) => ({
      swLatitude: iy * CELL_LAT_DEG,
      swLongitude: ix * CELL_LON_DEG,
    });

    return jsonFileResponse(
      {
        kind,
        mode,
        generatedAt: new Date().toISOString(),
        minPublicCellUsers: MIN_PUBLIC_CELL_USERS,
        cellSizeFeet: CELL_SIZE_FEET,
        cellSizeMeters: CELL_SIZE_METERS,
        bumpiness: bumps.rows.map((c) => {
          const ix = Number(c.ix);
          const iy = Number(c.iy);
          const sum = Number(c.sum);
          const count = Number(c.count);
          const avg = count > 0 ? sum / count : 0;
          return {
            ix,
            iy,
            ...cellLatLon(ix, iy),
            sum,
            count,
            ...(kind === 'display' ? { avgBumpiness: avg } : {}),
          };
        }),
        brakes: brakes.rows.map((c) => {
          const ix = Number(c.ix);
          const iy = Number(c.iy);
          const count = Number(c.count);
          return {
            ix,
            iy,
            ...cellLatLon(ix, iy),
            count,
            ...(kind === 'display' ? { colorBin: incidentColorBin(count) } : {}),
          };
        }),
        closeCalls: closeCalls.rows.map((c) => {
          const ix = Number(c.ix);
          const iy = Number(c.iy);
          const count = Number(c.count);
          return {
            ix,
            iy,
            ...cellLatLon(ix, iy),
            count,
            ...(kind === 'display' ? { colorBin: incidentColorBin(count) } : {}),
          };
        }),
      },
      `public-map-${kind}-${mode}.json`,
    );
  } catch (err) {
    console.error('public-map export failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
