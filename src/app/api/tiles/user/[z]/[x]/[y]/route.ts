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

  const bbox = tileQueryBbox(z, x, y);

  // Aggregate cells from this user's ride_points inside the bbox.
  // CELL_*_DEG are JS-side constants; embed as literals so the query plan
  // doesn't need to be re-prepared per call.
  //
  // Calibration applies regardless of the filter: pocket-mode samples
  // are scaled by the user's pocket_gain when their calibration is in
  // effect (pocket_confidence >= CONFIDENCE_FLOOR), matching the rule
  // the iOS app applies on-device. Mounted samples always use raw
  // bumpiness. When the filter excludes pocket rides, the CASE branch
  // is unreachable anyway.
  const sql = `
    SELECT
      floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      SUM(
        CASE
          WHEN r.pocket_mode = TRUE
            AND u.pocket_confidence >= ${CONFIDENCE_FLOOR}
            THEN rp.bumpiness * u.pocket_gain
          ELSE rp.bumpiness
        END
      ) AS sum,
      COUNT(*)::int AS count
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE r.user_id = $1
      AND rp.latitude  BETWEEN $2 AND $3
      AND rp.longitude BETWEEN $4 AND $5
      ${modeFilter}
    GROUP BY ix, iy
  `;

  let cells: Cell[];
  try {
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
  } catch (err) {
    console.error('user tile query failed', err);
    return NOT_FOUND_TILE(500);
  }

  const png = renderTile(z, x, y, cells);
  return new Response(new Uint8Array(png), { status: 200, headers: PNG_HEADERS });
}
