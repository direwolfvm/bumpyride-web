import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import { CONFIDENCE_FLOOR } from '@/lib/calibration';
import {
  emptyTilePng,
  renderTile,
  tileQueryBbox,
  type Cell,
} from '@/lib/tile-renderer';
import {
  parseTileMode,
  parseTilePercentile,
  type TileMode,
  type TilePercentile,
} from '@/lib/tile-mode';
import {
  parseRidesFilter,
  ridesFilterSql,
  type RidesFilter,
} from '@/lib/user-tile-helpers';
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-user bump-map tiles. Aggregates the user's own ride_points on
// demand — no maintained user_bump_cells table.
//
// Query parameters (all optional, all default to friendly choices):
//   ?rides=mounted|pocket|all   ride-mode filter; default mounted.
//                               (Renamed from the previous `?mode=`
//                               so it doesn't collide with the time-
//                               window mode below — see lib/user-
//                               tile-helpers.ts for legacy handling.)
//   ?mode=all|3mo|last10        time window; default all.
//   ?percentile=all|top10|bottom10  percentile filter; default all.
//
// Calibration: pocket-mode samples get scaled by the rider's
// pocket_gain when pocket_confidence >= CONFIDENCE_FLOOR. Matches
// the iOS on-device behaviour exactly.

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, max-age=300',
} as const;

const NOT_FOUND_TILE = (status = 200) =>
  new Response(new Uint8Array(emptyTilePng()), { status, headers: PNG_HEADERS });

// Per-cell bumpiness aggregation expression, with pocket calibration
// applied per-sample. Used as the SELECT body for both the bbox query
// and the threshold-compute path.
const CELL_AGGREGATE_EXPR = `
  floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
  floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
  SUM(
    CASE
      WHEN r.pocket_mode = TRUE
        AND u.pocket_confidence >= ${CONFIDENCE_FLOOR}
        THEN rp.bumpiness * u.pocket_gain
      ELSE rp.bumpiness
    END
  )::float8 AS sum,
  COUNT(*)::int AS count
`;

// For the last-10-samples-per-cell mode we need the per-sample
// calibrated bumpiness value (no SUM yet), so we expose that as a
// separate fragment that the windowed CTE projects.
const PER_SAMPLE_EXPR = `
  floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
  floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
  CASE
    WHEN r.pocket_mode = TRUE
      AND u.pocket_confidence >= ${CONFIDENCE_FLOOR}
      THEN rp.bumpiness * u.pocket_gain
    ELSE rp.bumpiness
  END AS bump,
  rp.timestamp
`;

function sourceFrom(rides: RidesFilter, timeFilter: string): string {
  return `
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE r.user_id = $1
      ${ridesFilterSql(rides)}
      ${timeFilter}
  `;
}

// Build the bbox-bounded per-tile query for the given (rides, mode).
function bboxQuery(rides: RidesFilter, mode: TileMode): string {
  const timeFilter =
    mode === '3mo' ? "AND rp.timestamp > now() - interval '3 months'" : '';
  const bboxFilter = `
    AND rp.latitude  BETWEEN $2 AND $3
    AND rp.longitude BETWEEN $4 AND $5
  `;
  if (mode === 'last10') {
    return `
      WITH samples AS (
        SELECT ${PER_SAMPLE_EXPR}
        ${sourceFrom(rides, '')}
        ${bboxFilter}
      ),
      ranked AS (
        SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
          FROM samples
      )
      SELECT ix, iy, SUM(bump)::float8 AS sum, COUNT(*)::int AS count
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
    `;
  }
  return `
    SELECT ${CELL_AGGREGATE_EXPR}
    ${sourceFrom(rides, timeFilter)}
    ${bboxFilter}
    GROUP BY ix, iy
  `;
}

// Threshold-compute path: same shape, no bbox.
function thresholdQuery(rides: RidesFilter, mode: TileMode): string {
  const timeFilter =
    mode === '3mo' ? "AND rp.timestamp > now() - interval '3 months'" : '';
  if (mode === 'last10') {
    return `
      WITH samples AS (
        SELECT ${PER_SAMPLE_EXPR}
        ${sourceFrom(rides, '')}
      ),
      ranked AS (
        SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
          FROM samples
      ),
      cells AS (
        SELECT ix, iy, SUM(bump)::float8 AS sum, COUNT(*)::int AS count
          FROM ranked
         WHERE rn <= 10
         GROUP BY ix, iy
      ),
      filtered AS (SELECT * FROM cells WHERE count > 0)
      SELECT
        percentile_cont(0.1) WITHIN GROUP (ORDER BY sum / count) AS lo,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY sum / count) AS hi
      FROM filtered
    `;
  }
  return `
    WITH cells AS (
      SELECT ${CELL_AGGREGATE_EXPR}
      ${sourceFrom(rides, timeFilter)}
      GROUP BY ix, iy
    ),
    filtered AS (SELECT * FROM cells WHERE count > 0)
    SELECT
      percentile_cont(0.1) WITHIN GROUP (ORDER BY sum / count) AS lo,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY sum / count) AS hi
    FROM filtered
  `;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NOT_FOUND_TILE(401);
  }

  const { z: zRaw, x: xRaw, y: yRaw } = await params;
  const z = Number.parseInt(zRaw, 10);
  const x = Number.parseInt(xRaw, 10);
  const y = Number.parseInt(yRaw, 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return NOT_FOUND_TILE(400);
  }
  if (z < 0 || z > 22) return NOT_FOUND_TILE(400);

  const sp = req.nextUrl.searchParams;
  const rides: RidesFilter = parseRidesFilter(sp.get('rides') ?? sp.get('mode'));
  // If the legacy `?mode=mounted|pocket|all` slot consumed the param,
  // treat the time-window as all. Otherwise read the new `?mode=` slot.
  const legacyRideMode = ['mounted', 'pocket', 'all'].includes(sp.get('mode') ?? '');
  const mode: TileMode = legacyRideMode
    ? 'all'
    : parseTileMode(sp.get('mode'));
  const percentile: TilePercentile = parseTilePercentile(sp.get('percentile'));

  const bbox = tileQueryBbox(z, x, y);

  let cells: Cell[];
  try {
    const res = await pool.query<Cell>(bboxQuery(rides, mode), [
      session.user.id,
      bbox.south,
      bbox.north,
      bbox.west,
      bbox.east,
    ]);
    cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      sum: Number(r.sum),
      count: Number(r.count),
    }));

    if (percentile !== 'all') {
      const threshold = await getOrComputeThreshold(
        `user:bumpiness:${session.user.id}:${rides}:${mode}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            thresholdQuery(rides, mode),
            [session.user.id],
          );
          const row = r.rows[0];
          if (!row || row.lo == null || row.hi == null) {
            return NO_DATA_THRESHOLD;
          }
          return { lo: Number(row.lo), hi: Number(row.hi) };
        },
      );
      cells = cells.filter((c) => {
        if (c.count <= 0) return false;
        const avg = c.sum / c.count;
        return percentile === 'top10'
          ? avg <= threshold.lo
          : avg >= threshold.hi;
      });
    }
  } catch (err) {
    console.error('user tile query failed', err);
    return NOT_FOUND_TILE(500);
  }

  const png = renderTile(z, x, y, cells);
  return new Response(new Uint8Array(png), { status: 200, headers: PNG_HEADERS });
}
