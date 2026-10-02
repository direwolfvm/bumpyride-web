import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import {
  emptyTilePng,
  renderFlatCellTile,
  tileQueryBbox,
} from '@/lib/tile-renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Others' visited cells" for the personal bump map: the public map's
// coverage minus your own. Answers "where have other riders been that I
// haven't?" — the blank space on your map that somebody else has
// already filled in.
//
// PRIVACY. This renders other people's coverage onto a logged-in user's
// map, so it shows EXACTLY the set already visible to anyone at /map and
// not one cell more. Same gate as the public tile route's fast path:
// a cell appears only when at least MIN_PUBLIC_CELL_USERS distinct
// sharing riders contributed to it, or one contributor has
// public_map_eager. bump_cells / bump_cell_contributors only ever
// receive mounted-mode rides from sharing-on accounts, so pocket-mode
// and opted-out data cannot reach this layer by construction.
//
// Nothing here is per-rider: the output is a flat set of cell
// coordinates with no counts, no values, no timestamps and no identity.
// Subtracting your own cells reveals nothing further — you already know
// where you have been.
//
// "Mine" deliberately means EVERY ride you own, ignoring the ?rides=
// filter the rest of the map uses. The question this layer answers is
// "have I ever been here", so a cell you only covered on a pocket-mode
// ride should not come back as somewhere you have never been.

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
  'Cache-Control': 'private, max-age=300',
} as const;

const TILE = (png: Buffer, status = 200) =>
  new Response(new Uint8Array(png), { status, headers: PNG_HEADERS });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return TILE(emptyTilePng(), 401);

  const { z: zRaw, x: xRaw, y: yRaw } = await params;
  const z = Number.parseInt(zRaw, 10);
  const x = Number.parseInt(xRaw, 10);
  const y = Number.parseInt(yRaw, 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return TILE(emptyTilePng(), 400);
  }
  if (z < 0 || z > 22) return TILE(emptyTilePng(), 400);

  const bbox = tileQueryBbox(z, x, y);
  const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
  const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
  const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
  const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);

  try {
    // Publishable cells in this tile, minus every cell the caller has
    // ridden. The NOT EXISTS runs against ride_points through the same
    // floor() grid maths the rest of the app uses, so "mine" matches
    // what the personal map draws.
    const res = await pool.query<{ ix: number; iy: number }>(
      `SELECT bc.ix, bc.iy
         FROM bump_cells bc
        WHERE bc.ix BETWEEN $2 AND $3
          AND bc.iy BETWEEN $4 AND $5
          AND bc.count > 0
          AND EXISTS (
            SELECT 1
              FROM bump_cell_contributors bcc
              JOIN users u ON u.id = bcc.user_id
             WHERE bcc.ix = bc.ix AND bcc.iy = bc.iy
            HAVING count(*) >= $6 OR bool_or(u.public_map_eager)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM ride_points rp
              JOIN rides r ON r.ride_uuid = rp.ride_uuid
             WHERE r.user_id = $1
               AND floor(rp.longitude / ${CELL_LON_DEG}::float8)::int = bc.ix
               AND floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int = bc.iy
          )`,
      [session.user.id, ixMin, ixMax, iyMin, iyMax, MIN_PUBLIC_CELL_USERS],
    );

    const cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
    }));
    return TILE(renderFlatCellTile(z, x, y, cells));
  } catch (err) {
    console.error('others-visited tile query failed', err);
    return TILE(emptyTilePng(), 500);
  }
}
