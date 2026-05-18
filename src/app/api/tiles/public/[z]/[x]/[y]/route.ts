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
// maintained `bump_cells` table, applying a minimum-distinct-users
// threshold so a single rider's solo route doesn't appear in public
// until the cells are reinforced by other contributors.
//
// A cell renders if EITHER
//   (a) at least MIN_PUBLIC_CELL_USERS distinct sharing users have
//       contributed to it, OR
//   (b) at least one of its contributors has `public_map_eager = TRUE`
//       (the per-user escape valve — e.g. for power users seeding a
//       brand-new region).
//
// The threshold is configurable via env so we can dial it in as the
// user base grows. The legacy `PUBLIC_BUMPMAP_MIN_COUNT` env var is
// still read for back-compat with deployments that haven't migrated.

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
    // For each cell in the tile's bbox, the EXISTS subquery decides
    // visibility using the contributor set. `HAVING count(*) >= N OR
    // bool_or(public_map_eager)` collapses both conditions into one
    // pass over the cell's contributor rows (PK-indexed by ix, iy).
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
