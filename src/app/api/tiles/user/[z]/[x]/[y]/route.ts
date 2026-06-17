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
  parseTileBumpAgg,
  parseTileMode,
  parseTilePercentile,
  type TileBumpAgg,
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
//   ?agg=avg|median|max         per-cell aggregation; default avg.
//
// Aggregation is encoded into the (sum, count) tuple so the renderer
// can stay one-shape: sum / count = the displayed metric. For median
// and max we set count=1 and stuff the chosen metric into sum.
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

// Per-sample calibrated bumpiness expression — used in every SQL path
// here. Pocket calibration is applied per-sample, matching iOS.
const CALIBRATED_BUMP = `
  CASE
    WHEN r.pocket_mode = TRUE
      AND u.pocket_confidence >= ${CONFIDENCE_FLOOR}
      THEN rp.bumpiness * u.pocket_gain
    ELSE rp.bumpiness
  END
`;

// Per-cell aggregation projected as (sum, count) such that sum/count
// is the displayed value. For avg we project the natural SUM + COUNT
// so the renderer can keep its existing avg = sum/count math. For
// median and max we set count=1 and stuff the chosen metric into sum.
function cellAggregateExpr(agg: TileBumpAgg): string {
  const base = `
    floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
    floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
  `;
  if (agg === 'median') {
    return `${base}
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${CALIBRATED_BUMP})::float8 AS sum,
      1::int AS count
    `;
  }
  if (agg === 'max') {
    return `${base}
      MAX(${CALIBRATED_BUMP})::float8 AS sum,
      1::int AS count
    `;
  }
  return `${base}
    SUM(${CALIBRATED_BUMP})::float8 AS sum,
    COUNT(*)::int AS count
  `;
}

// last10 mode does its aggregation inside the renderer-shape SELECT
// (after the row_number filter), so we hand the per-sample bumpiness
// out raw and aggregate downstream the same way as the bbox path.
const PER_SAMPLE_EXPR = `
  floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
  floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
  ${CALIBRATED_BUMP} AS bump,
  rp.timestamp
`;

// Aggregate the ranked-sample subquery the same way as cellAggregateExpr,
// but operating on the already-projected `bump` column from the CTE.
function rankedAggregateExpr(agg: TileBumpAgg): string {
  if (agg === 'median') {
    return `
      ix, iy,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY bump)::float8 AS sum,
      1::int AS count
    `;
  }
  if (agg === 'max') {
    return `
      ix, iy,
      MAX(bump)::float8 AS sum,
      1::int AS count
    `;
  }
  return `
    ix, iy,
    SUM(bump)::float8 AS sum,
    COUNT(*)::int AS count
  `;
}

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

// Build the bbox-bounded per-tile query for the given (rides, mode, agg).
function bboxQuery(rides: RidesFilter, mode: TileMode, agg: TileBumpAgg): string {
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
      SELECT ${rankedAggregateExpr(agg)}
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
    `;
  }
  return `
    SELECT ${cellAggregateExpr(agg)}
    ${sourceFrom(rides, timeFilter)}
    ${bboxFilter}
    GROUP BY ix, iy
  `;
}

// Threshold-compute path: same shape, no bbox. The percentile cutoff
// is computed over sum/count, which (per cellAggregateExpr) equals
// the displayed metric for any agg.
function thresholdQuery(rides: RidesFilter, mode: TileMode, agg: TileBumpAgg): string {
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
        SELECT ${rankedAggregateExpr(agg)}
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
      SELECT ${cellAggregateExpr(agg)}
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
  const agg: TileBumpAgg = parseTileBumpAgg(sp.get('agg'));

  const bbox = tileQueryBbox(z, x, y);

  // ?style=halo strips the colored fill, leaving only the purple
  // glow halo around every coverage cell. Used by the events-mode
  // backdrop on the brakes / close-call layers so the user sees
  // where they've been without the bumpiness color competing with
  // the event markers.
  const style = sp.get('style') === 'halo' ? 'halo' : 'fill';

  let coloredCells: Cell[];
  let haloOnlyCells: ReadonlyArray<{ ix: number; iy: number }> = [];
  try {
    const res = await pool.query<Cell>(bboxQuery(rides, mode, agg), [
      session.user.id,
      bbox.south,
      bbox.north,
      bbox.west,
      bbox.east,
    ]);
    const allCells: Cell[] = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      sum: Number(r.sum),
      count: Number(r.count),
    }));

    if (style === 'halo') {
      // No fill, halo-only — render every coverage cell as a glow
      // backdrop. Skip the percentile / threshold work entirely.
      coloredCells = [];
      haloOnlyCells = allCells.filter((c) => c.count > 0);
    } else if (percentile !== 'all') {
      const threshold = await getOrComputeThreshold(
        `user:bumpiness:${session.user.id}:${rides}:${mode}:${agg}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            thresholdQuery(rides, mode, agg),
            [session.user.id],
          );
          const row = r.rows[0];
          if (!row || row.lo == null || row.hi == null) {
            return NO_DATA_THRESHOLD;
          }
          return { lo: Number(row.lo), hi: Number(row.hi) };
        },
      );
      // Split into colored (in-bucket) + halo-only (out-of-bucket
      // but still coverage). Keeping the out-of-bucket halo means
      // the user keeps spatial context for the broader dataset
      // while the in-bucket cells stand out.
      coloredCells = [];
      const haloOnly: { ix: number; iy: number }[] = [];
      for (const c of allCells) {
        if (c.count <= 0) continue;
        const avg = c.sum / c.count;
        const inBucket =
          percentile === 'top10' ? avg <= threshold.lo : avg >= threshold.hi;
        if (inBucket) coloredCells.push(c);
        else haloOnly.push({ ix: c.ix, iy: c.iy });
      }
      haloOnlyCells = haloOnly;
    } else {
      coloredCells = allCells;
    }
  } catch (err) {
    console.error('user tile query failed', err);
    return NOT_FOUND_TILE(500);
  }

  const png = renderTile(z, x, y, coloredCells, haloOnlyCells);
  return new Response(new Uint8Array(png), { status: 200, headers: PNG_HEADERS });
}
