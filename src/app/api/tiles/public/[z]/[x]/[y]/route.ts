import { NextRequest } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import {
  emptyTilePng,
  renderTile,
  tileQueryBbox,
  type Cell,
} from '@/lib/tile-renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public aggregated bump-map tiles. Anonymous access; reads from the
// maintained `bump_cells` table, applying a minimum-count threshold so a
// single rider's solo route doesn't appear in public until the cells are
// reinforced by other contributions.
//
// The threshold is configurable via env so we can dial it in as the user
// base grows.

const MIN_PUBLIC_CELL_COUNT = Math.max(
  1,
  Number.parseInt(process.env.PUBLIC_BUMPMAP_MIN_COUNT ?? '3', 10) || 3,
);

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  // Same content for every viewer; can cache aggressively at the edge.
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
} as const;

const respondTile = (png: Buffer, status = 200) =>
  new Response(new Uint8Array(png), { status, headers: PNG_HEADERS });

export async function GET(
  _req: NextRequest,
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

  const bbox = tileQueryBbox(z, x, y);

  // bump_cells is already keyed by (ix, iy), so we query directly on those
  // index ranges rather than re-deriving them in SQL.
  const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
  const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
  const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
  const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);

  let cells: Cell[];
  try {
    const res = await pool.query<Cell>(
      `SELECT ix, iy, sum, count FROM bump_cells
        WHERE ix BETWEEN $1 AND $2
          AND iy BETWEEN $3 AND $4
          AND count >= $5`,
      [ixMin, ixMax, iyMin, iyMax, MIN_PUBLIC_CELL_COUNT],
    );
    cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      sum: Number(r.sum),
      count: Number(r.count),
    }));
  } catch (err) {
    console.error('public tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderTile(z, x, y, cells));
}
