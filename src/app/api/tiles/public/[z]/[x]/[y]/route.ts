import { NextRequest } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import {
  emptyTilePng,
  renderTile,
  tileQueryBbox,
  type Cell,
} from '@/lib/tile-renderer';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public aggregated bump-map tiles. Anonymous access.
//
// Accepts ?mode=all|3mo|last10. The mode picks which underlying data
// feeds the per-cell average:
//   all     — the maintained `bump_cells` aggregate (cheap, every
//             eligible sample ever recorded).
//   3mo     — scan ride_points in bbox, restrict to the last 3
//             months, group + privacy-gate at query time.
//   last10  — scan ride_points in bbox, take the 10 most recent
//             samples per cell, group + privacy-gate.
//
// A cell renders if EITHER
//   (a) at least MIN_PUBLIC_CELL_USERS distinct sharing users have
//       contributed to it (in the chosen mode), OR
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

async function queryAllMode(args: {
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

async function queryWindowedMode(
  mode: '3mo' | 'last10',
  args: { west: number; east: number; south: number; north: number },
): Promise<Cell[]> {
  // Both modes scan ride_points by bbox + privacy filters, then
  // diverge on the inner filter / window. The bump_cells aggregate
  // can't help here — we re-aggregate on the fly so the time window
  // is honored.
  const sourceCte = (extraFilter = '') => `
    WITH sample_cells AS (
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
        AND rp.longitude BETWEEN $1 AND $2
        AND rp.latitude  BETWEEN $3 AND $4
        ${extraFilter}
    )
  `;
  let sql: string;
  if (mode === '3mo') {
    sql = `
      ${sourceCte("AND rp.timestamp > now() - interval '3 months'")}
      SELECT ix, iy,
             sum(bumpiness)::float8 AS sum,
             count(*)::bigint       AS count
        FROM sample_cells
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= $5 OR bool_or(public_map_eager)
    `;
  } else {
    sql = `
      ${sourceCte()}
      , ranked AS (
        SELECT *,
               row_number() OVER (PARTITION BY ix, iy ORDER BY timestamp DESC) AS rn
          FROM sample_cells
      )
      SELECT ix, iy,
             sum(bumpiness)::float8 AS sum,
             count(*)::bigint       AS count
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= $5 OR bool_or(public_map_eager)
    `;
  }
  const res = await pool.query<Cell>(sql, [
    args.west,
    args.east,
    args.south,
    args.north,
    MIN_PUBLIC_CELL_USERS,
  ]);
  return res.rows.map((r) => ({
    ix: Number(r.ix),
    iy: Number(r.iy),
    sum: Number(r.sum),
    count: Number(r.count),
  }));
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

  const mode: TileMode = parseTileMode(new URL(req.url).searchParams.get('mode'));
  const bbox = tileQueryBbox(z, x, y);

  let cells: Cell[];
  try {
    cells =
      mode === 'all'
        ? await queryAllMode(bbox)
        : await queryWindowedMode(mode, bbox);
  } catch (err) {
    console.error('public tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderTile(z, x, y, cells));
}
