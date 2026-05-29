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
import { parseTilePercentile, type TilePercentile } from '@/lib/tile-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-user bump-map tiles. Aggregates the user's own ride_points on demand
// (no maintained user_bump_cells table yet — see README/Phase 4 notes for
// the optimisation path when scale demands it).

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, max-age=300',
} as const;

const NOT_FOUND_TILE = (status = 200) =>
  new Response(new Uint8Array(emptyTilePng()), { status, headers: PNG_HEADERS });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    // Browsers will display a broken tile rather than an error page.
    // Return an empty tile + 401 so curl/logs still see the status.
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

  // Filter chip on /bump-map, mirroring the iOS Bump Map's three-option
  // segmented control:
  //
  //   ?mode=all      include every ride
  //   ?mode=mounted  pocket_mode IS DISTINCT FROM TRUE   (mounted + null)
  //   ?mode=pocket   pocket_mode = TRUE
  //
  // Default (missing/unknown) is `mounted` — same default as iOS. Legacy
  // rides where pocket_mode IS NULL bucket with mounted (early users
  // almost universally had handlebar mounts; bucketing them with
  // mounted matches reality and doesn't penalise no-recourse).
  const mode = req.nextUrl.searchParams.get('mode');
  let modeFilter = '';
  if (mode === 'all') {
    modeFilter = '';
  } else if (mode === 'pocket') {
    modeFilter = 'AND r.pocket_mode = TRUE';
  } else {
    // mounted (default)
    modeFilter = 'AND r.pocket_mode IS DISTINCT FROM TRUE';
  }

  // Best/worst-10% percentile filter, separate from the mounted/
  // pocket mode above. `all` keeps the fast bbox-only path; `top10`
  // (best, lowest avg bumpiness) and `bottom10` (worst, highest avg)
  // compute the cutoff across all of this user's cells matching the
  // mode filter — so "best 10%" means against the user's own
  // dataset, not the viewport.
  const percentile: TilePercentile = parseTilePercentile(
    req.nextUrl.searchParams.get('percentile'),
  );

  const bbox = tileQueryBbox(z, x, y);

  // Aggregate cells from this user's ride_points. The per-cell
  // bumpiness applies the same per-rider pocket calibration the
  // iOS app uses on-device. Two SQL shapes:
  //
  //   percentile === 'all': aggregate within the bbox only (fast).
  //   percentile != 'all':  aggregate over every cell (no bbox),
  //                         compute percentile_cont threshold,
  //                         then filter by bbox + threshold.
  const cellAggregateExpr = `
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
  const sourceFrom = `
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE r.user_id = $1
      ${modeFilter}
  `;

  let cells: Cell[];
  try {
    if (percentile === 'all') {
      const sql = `
        SELECT ${cellAggregateExpr}
        ${sourceFrom}
          AND rp.latitude  BETWEEN $2 AND $3
          AND rp.longitude BETWEEN $4 AND $5
        GROUP BY ix, iy
      `;
      const res = await pool.query<Cell>(sql, [
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
    } else {
      const pred =
        percentile === 'top10'
          ? '(c.sum / c.count) <= t.lo'
          : '(c.sum / c.count) >= t.hi';
      const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
      const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
      const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
      const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);
      const sql = `
        WITH cells AS (
          SELECT ${cellAggregateExpr}
          ${sourceFrom}
          GROUP BY ix, iy
        ),
        filtered AS (SELECT * FROM cells WHERE count > 0),
        threshold AS (
          SELECT
            percentile_cont(0.1) WITHIN GROUP (ORDER BY sum / count) AS lo,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY sum / count) AS hi
          FROM filtered
        )
        SELECT c.ix, c.iy, c.sum, c.count
          FROM filtered c, threshold t
         WHERE c.ix BETWEEN $2 AND $3
           AND c.iy BETWEEN $4 AND $5
           AND ${pred}
      `;
      const res = await pool.query<Cell>(sql, [
        session.user.id,
        ixMin,
        ixMax,
        iyMin,
        iyMax,
      ]);
      cells = res.rows.map((r) => ({
        ix: Number(r.ix),
        iy: Number(r.iy),
        sum: Number(r.sum),
        count: Number(r.count),
      }));
    }
  } catch (err) {
    console.error('user tile query failed', err);
    return NOT_FOUND_TILE(500);
  }

  const png = renderTile(z, x, y, cells);
  return new Response(new Uint8Array(png), { status: 200, headers: PNG_HEADERS });
}
