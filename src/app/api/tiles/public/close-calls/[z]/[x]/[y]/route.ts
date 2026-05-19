import { NextRequest } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import {
  emptyTilePng,
  type IncidentCell,
  renderIncidentTile,
  tileQueryBbox,
} from '@/lib/tile-renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public close-call tile renderer. Same shape as the public brake tile
// route — different source table.
//
// Privacy is more critical here than for brakes or bumps: a close call
// is "the user felt unsafe here," and a sparse cell could trivially
// identify a solo rider's regular route. The 3-distinct-rider gate
// below is what keeps that data out of the public map; per-user
// `public_map_eager = TRUE` remains the explicit opt-out from the
// threshold.

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

  let cells: IncidentCell[];
  try {
    const res = await pool.query<{ ix: number; iy: number; event_count: number }>(
      `WITH event_cells AS (
         SELECT
           floor(c.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
           floor(c.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
           r.user_id,
           u.public_map_eager
         FROM close_call_events c
         JOIN rides r ON r.ride_uuid = c.ride_uuid
         JOIN users u ON u.id = r.user_id
         WHERE u.share_to_public_map = TRUE
           AND r.pocket_mode IS DISTINCT FROM TRUE
           AND c.longitude BETWEEN $1 AND $2
           AND c.latitude  BETWEEN $3 AND $4
       )
       SELECT ix, iy, count(*)::int AS event_count
         FROM event_cells
        GROUP BY ix, iy
       HAVING count(DISTINCT user_id) >= $5 OR bool_or(public_map_eager)`,
      [bbox.west, bbox.east, bbox.south, bbox.north, MIN_PUBLIC_CELL_USERS],
    );
    cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      count: Number(r.event_count),
    }));
  } catch (err) {
    console.error('public close-call tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderIncidentTile(z, x, y, cells));
}
