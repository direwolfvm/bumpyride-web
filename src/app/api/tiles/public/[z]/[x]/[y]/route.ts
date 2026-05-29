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
  parseTileMode,
  parseTilePercentile,
  type TileMode,
  type TilePercentile,
} from '@/lib/tile-mode';
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public aggregated bump-map tiles. Anonymous access.
//
// Accepts two query parameters:
//   ?mode=all|3mo|last10        time window (see lib/tile-mode.ts)
//   ?percentile=all|top10|bottom10
//       all      — render every gate-passing cell.
//       top10    — only cells whose avg bumpiness is <= the 10th
//                  percentile across the whole dataset (= smoothest).
//       bottom10 — only cells whose avg bumpiness is >= the 90th
//                  percentile (= roughest).
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

// Builds the gate-passing per-cell CTE for a given mode. Used by both
// the windowed-mode path and the percentile path so they apply the
// same privacy + mode filter.
function cellsCteSource(mode: TileMode): string {
  if (mode === 'all') {
    // Use the maintained aggregate; gate via EXISTS.
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
             sum(bumpiness)::float8 AS sum,
             count(*)::bigint       AS count
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
    `;
  }
  // mode === '3mo'
  return `
    WITH sc AS (${inner})
    SELECT ix, iy,
           sum(bumpiness)::float8 AS sum,
           count(*)::bigint       AS count
      FROM sc
     GROUP BY ix, iy
    HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
  `;
}

async function queryWindowedMode(
  mode: '3mo' | 'last10',
  args: { west: number; east: number; south: number; north: number },
): Promise<Cell[]> {
  const sql = `
    WITH cells AS (${cellsCteSource(mode)})
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

async function fetchPercentileThreshold(mode: TileMode) {
  // Memoised in src/lib/percentile-cache.ts. Cold-path query scans
  // the gate-passing set for the layer+mode and computes the (0.1,
  // 0.9) cutoffs on avg bumpiness. Subsequent requests within the
  // TTL skip the DB entirely.
  return getOrComputeThreshold(
    `public:bumpiness:${mode}`,
    async (client) => {
      const r = await client.query<{ lo: number | null; hi: number | null }>(
        `WITH cells AS (${cellsCteSource(mode)}),
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
  const bbox = tileQueryBbox(z, x, y);

  let cells: Cell[];
  try {
    // Same bbox query for every percentile choice — pull the cells
    // for this tile via the existing fast (or windowed) path, then
    // apply the cached percentile cutoff in JS when needed.
    cells = mode === 'all'
      ? await queryAllModeFast(bbox)
      : await queryWindowedMode(mode, bbox);

    if (percentile !== 'all') {
      const threshold = await fetchPercentileThreshold(mode);
      cells = cells.filter((c) => {
        if (c.count <= 0) return false;
        const avg = c.sum / c.count;
        return percentile === 'top10'
          ? avg <= threshold.lo
          : avg >= threshold.hi;
      });
    }
  } catch (err) {
    console.error('public tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderTile(z, x, y, cells));
}
