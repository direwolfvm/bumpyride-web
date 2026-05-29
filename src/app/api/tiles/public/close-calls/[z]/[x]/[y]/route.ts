import { NextRequest } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import {
  emptyTilePng,
  type IncidentCell,
  renderIncidentTile,
  tileQueryBbox,
} from '@/lib/tile-renderer';
import {
  parseTileMode,
  parseTilePercentile,
  type TileMode,
  type TilePercentile,
} from '@/lib/tile-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public close-call tile renderer. Same shape as the brake tile route
// — different source table, same per-feature 3-distinct-rider gate.
//
// Accepts ?mode= and ?percentile= with identical semantics.

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

function cellsCte(mode: TileMode): string {
  const filter =
    mode === '3mo' ? "AND c.timestamp > now() - interval '3 months'" : '';
  const sourceCte = `
    SELECT
      floor(c.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(c.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      r.user_id,
      u.public_map_eager,
      c.timestamp AS ts
    FROM close_call_events c
    JOIN rides r ON r.ride_uuid = c.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE u.share_to_public_map = TRUE
      AND r.pocket_mode IS DISTINCT FROM TRUE
      ${filter}
  `;
  if (mode === 'last10') {
    return `
      WITH event_cells AS (${sourceCte}),
           ranked AS (
             SELECT ix, iy, user_id, public_map_eager,
                    row_number() OVER (PARTITION BY ix, iy ORDER BY ts DESC) AS rn
               FROM event_cells
           )
      SELECT ix, iy, count(*)::int AS count
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
    `;
  }
  return `
    WITH event_cells AS (${sourceCte})
    SELECT ix, iy, count(*)::int AS count
      FROM event_cells
     GROUP BY ix, iy
    HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
  `;
}

function finalSql(mode: TileMode, percentile: TilePercentile): string {
  if (percentile === 'all') {
    return `
      WITH cells AS (${cellsCte(mode)})
      SELECT ix, iy, count
        FROM cells
       WHERE ix BETWEEN $1 AND $2
         AND iy BETWEEN $3 AND $4
    `;
  }
  const pred = percentile === 'top10' ? 'c.count <= t.lo' : 'c.count >= t.hi';
  return `
    WITH cells AS (${cellsCte(mode)}),
         threshold AS (
           SELECT
             percentile_cont(0.1) WITHIN GROUP (ORDER BY count) AS lo,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY count) AS hi
           FROM cells
         )
    SELECT c.ix, c.iy, c.count
      FROM cells c, threshold t
     WHERE c.ix BETWEEN $1 AND $2
       AND c.iy BETWEEN $3 AND $4
       AND ${pred}
  `;
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
  const mode = parseTileMode(url.searchParams.get('mode'));
  const percentile = parseTilePercentile(url.searchParams.get('percentile'));
  const bbox = tileQueryBbox(z, x, y);

  const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
  const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
  const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
  const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);

  let cells: IncidentCell[];
  try {
    const sql = finalSql(mode, percentile);
    const res = await pool.query<{ ix: number; iy: number; count: number }>(
      sql,
      [ixMin, ixMax, iyMin, iyMax],
    );
    cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      count: Number(r.count),
    }));
  } catch (err) {
    console.error('public close-call tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderIncidentTile(z, x, y, cells));
}
