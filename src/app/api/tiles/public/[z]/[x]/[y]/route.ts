import { NextRequest } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
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
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public aggregated bump-map tiles. Anonymous access.
//
// Accepts three query parameters:
//   ?mode=all|3mo|last10        time window (see lib/tile-mode.ts)
//   ?percentile=all|top10|bottom10
//       all      — render every gate-passing cell.
//       top10    — only cells whose per-cell value is <= the 10th
//                  percentile across the whole dataset (= smoothest).
//       bottom10 — only cells whose per-cell value is >= the 90th
//                  percentile (= roughest).
//   ?agg=avg|median|max         per-cell aggregation; default avg.
//                               avg uses the maintained bump_cells
//                               table for the fast path. median/max
//                               require re-aggregating ride_points
//                               and skip the fast path.
//
// Privacy gate (3 distinct sharing users OR any one with
// public_map_eager) applies in every mode; percentile is computed
// AFTER the gate, so the "best/worst 10%" claim is about publishable
// cells specifically.

const MIN_PUBLIC_CELL_USERS = Math.max(
  1,
  Number.parseInt(
    process.env.PUBLIC_BUMPMAP_MIN_USERS ??
      process.env.PUBLIC_BUMPMAP_MIN_COUNT ??
      '3',
    10,
  ) || 3,
);

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
} as const;

const respondTile = (png: Buffer, status = 200) =>
  new Response(new Uint8Array(png), { status, headers: PNG_HEADERS });

// All-mode + percentile=all is the hot path: a direct bbox lookup
// against the maintained bump_cells aggregate with the gate. The
// other combinations re-aggregate from ride_points and/or compute
// percentile thresholds at query time.

async function queryAllModeFast(args: {
  west: number;
  east: number;
  south: number;
  north: number;
}): Promise<Cell[]> {
  const ixMin = Math.floor(args.west / CELL_LON_DEG);
  const ixMax = Math.floor(args.east / CELL_LON_DEG);
  const iyMin = Math.floor(args.south / CELL_LAT_DEG);
  const iyMax = Math.floor(args.north / CELL_LAT_DEG);
  const res = await pool.query<Cell>(
    `SELECT bc.ix, bc.iy, bc.sum, bc.count
       FROM bump_cells bc
      WHERE bc.ix BETWEEN $1 AND $2
        AND bc.iy BETWEEN $3 AND $4
        AND EXISTS (
          SELECT 1
            FROM bump_cell_contributors bcc
            JOIN users u ON u.id = bcc.user_id
           WHERE bcc.ix = bc.ix AND bcc.iy = bc.iy
          HAVING count(*) >= $5 OR bool_or(u.public_map_eager)
        )`,
    [ixMin, ixMax, iyMin, iyMax, MIN_PUBLIC_CELL_USERS],
  );
  return res.rows.map((r) => ({
    ix: Number(r.ix),
    iy: Number(r.iy),
    sum: Number(r.sum),
    count: Number(r.count),
  }));
}

// Per-cell aggregation expression: SQL fragment that, when given a
// column named `bumpiness`, produces `sum` and `count` such that
// sum/count is the displayed value. For median/max we set count=1 and
// stuff the metric into sum so the renderer can stay one-shape.
function aggExpr(agg: TileBumpAgg, col: string): string {
  if (agg === 'median') {
    return `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${col})::float8 AS sum,
            1::bigint AS count`;
  }
  if (agg === 'max') {
    return `MAX(${col})::float8 AS sum,
            1::bigint AS count`;
  }
  return `SUM(${col})::float8 AS sum,
          COUNT(*)::bigint AS count`;
}

// Builds the gate-passing per-cell CTE for a given (mode, agg). Used
// by both the windowed-mode path and the percentile path so they
// apply the same privacy + mode filter.
function cellsCteSource(mode: TileMode, agg: TileBumpAgg): string {
  if (mode === 'all' && agg === 'avg') {
    // Avg + all-mode: maintained aggregate, gate via EXISTS. Fast path.
    return `
      SELECT bc.ix, bc.iy, bc.sum::float8 AS sum, bc.count::bigint AS count
        FROM bump_cells bc
       WHERE EXISTS (
         SELECT 1
           FROM bump_cell_contributors bcc
           JOIN users u ON u.id = bcc.user_id
          WHERE bcc.ix = bc.ix AND bcc.iy = bc.iy
         HAVING count(*) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(u.public_map_eager)
       )
    `;
  }
  // Everything else re-aggregates from ride_points. The agg expression
  // decides whether we sum, median, or max the per-cell bumpiness.
  const filter = mode === '3mo' ? "AND rp.timestamp > now() - interval '3 months'" : '';
  const inner = `
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
      ${filter}
  `;
  if (mode === 'last10') {
    return `
      WITH sc AS (${inner}),
           ranked AS (
             SELECT *, row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
               FROM sc
           )
      SELECT ix, iy,
             ${aggExpr(agg, 'bumpiness')}
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
    `;
  }
  // mode === '3mo' OR (mode === 'all' AND agg !== 'avg')
  return `
    WITH sc AS (${inner})
    SELECT ix, iy,
           ${aggExpr(agg, 'bumpiness')}
      FROM sc
     GROUP BY ix, iy
    HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
  `;
}

async function queryReaggregated(
  mode: TileMode,
  agg: TileBumpAgg,
  args: { west: number; east: number; south: number; north: number },
): Promise<Cell[]> {
  const sql = `
    WITH cells AS (${cellsCteSource(mode, agg)})
    SELECT ix, iy, sum, count
      FROM cells
     WHERE ix BETWEEN $1 AND $2
       AND iy BETWEEN $3 AND $4
  `;
  // We pass bbox by lon/lat range converted to cell-index range. Same
  // technique as the fast path.
  const ixMin = Math.floor(args.west / CELL_LON_DEG);
  const ixMax = Math.floor(args.east / CELL_LON_DEG);
  const iyMin = Math.floor(args.south / CELL_LAT_DEG);
  const iyMax = Math.floor(args.north / CELL_LAT_DEG);
  const res = await pool.query<Cell>(sql, [ixMin, ixMax, iyMin, iyMax]);
  return res.rows.map((r) => ({
    ix: Number(r.ix),
    iy: Number(r.iy),
    sum: Number(r.sum),
    count: Number(r.count),
  }));
}

async function fetchPercentileThreshold(mode: TileMode, agg: TileBumpAgg) {
  // Memoised in src/lib/percentile-cache.ts. Cold-path query scans
  // the gate-passing set for the layer+mode+agg and computes the
  // (0.1, 0.9) cutoffs on the per-cell value. Subsequent requests
  // within the TTL skip the DB entirely.
  return getOrComputeThreshold(
    `public:bumpiness:${mode}:${agg}`,
    async (client) => {
      const r = await client.query<{ lo: number | null; hi: number | null }>(
        `WITH cells AS (${cellsCteSource(mode, agg)}),
              filtered AS (SELECT * FROM cells WHERE count > 0)
         SELECT
           percentile_cont(0.1) WITHIN GROUP (ORDER BY sum / count) AS lo,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY sum / count) AS hi
         FROM filtered`,
      );
      const row = r.rows[0];
      if (!row || row.lo == null || row.hi == null) {
        return NO_DATA_THRESHOLD;
      }
      return { lo: Number(row.lo), hi: Number(row.hi) };
    },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z: zRaw, x: xRaw, y: yRaw } = await params;
  const z = Number.parseInt(zRaw, 10);
  const x = Number.parseInt(xRaw, 10);
  const y = Number.parseInt(yRaw, 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return respondTile(emptyTilePng(), 400);
  }
  if (z < 0 || z > 22) return respondTile(emptyTilePng(), 400);

  const url = new URL(req.url);
  const mode: TileMode = parseTileMode(url.searchParams.get('mode'));
  const percentile: TilePercentile = parseTilePercentile(
    url.searchParams.get('percentile'),
  );
  const agg: TileBumpAgg = parseTileBumpAgg(url.searchParams.get('agg'));
  const bbox = tileQueryBbox(z, x, y);

  let coloredCells: Cell[];
  let haloOnlyCells: ReadonlyArray<{ ix: number; iy: number }> = [];
  try {
    // Fast path: avg + all-mode, served from bump_cells. Every other
    // (mode, agg) re-aggregates ride_points behind the gate.
    const allCells = mode === 'all' && agg === 'avg'
      ? await queryAllModeFast(bbox)
      : await queryReaggregated(mode, agg, bbox);

    if (percentile !== 'all') {
      const threshold = await fetchPercentileThreshold(mode, agg);
      coloredCells = [];
      const haloOnly: { ix: number; iy: number }[] = [];
      // Split into in-bucket (colored) and out-of-bucket coverage
      // (halo only). Keeps spatial context for the broader public
      // dataset visible.
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
    console.error('public tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderTile(z, x, y, coloredCells, haloOnlyCells));
}
