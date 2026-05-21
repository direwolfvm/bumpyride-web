import { NextRequest } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import {
  emptyTilePng,
  type IncidentCell,
  renderIncidentTile,
  tileQueryBbox,
} from '@/lib/tile-renderer';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public close-call tile renderer. Same shape as the brake tile route —
// different source table and (intentionally) the same per-feature
// 3-distinct-rider privacy gate. See ./brakes/.../route.ts for the
// design notes; see CLOSE_CALLS_WEB_HANDOFF.md for the iOS-side
// privacy rationale (close calls are more sensitive than brakes).
//
// Accepts ?mode=all|3mo|last10 with identical semantics.

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

function queryFor(mode: TileMode): string {
  const cellExpr = `
    floor(c.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
    floor(c.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
  `;
  const sourceCte = (extraFilter = '') => `
    WITH event_cells AS (
      SELECT
        ${cellExpr}
        r.user_id,
        u.public_map_eager,
        c.timestamp AS ts
      FROM close_call_events c
      JOIN rides r ON r.ride_uuid = c.ride_uuid
      JOIN users u ON u.id = r.user_id
      WHERE u.share_to_public_map = TRUE
        AND r.pocket_mode IS DISTINCT FROM TRUE
        AND c.longitude BETWEEN $1 AND $2
        AND c.latitude  BETWEEN $3 AND $4
        ${extraFilter}
    )
  `;
  if (mode === '3mo') {
    return `
      ${sourceCte("AND c.timestamp > now() - interval '3 months'")}
      SELECT ix, iy, count(*)::int AS event_count
        FROM event_cells
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= $5 OR bool_or(public_map_eager)
    `;
  }
  if (mode === 'last10') {
    return `
      ${sourceCte()}
      , ranked AS (
        SELECT ix, iy, user_id, public_map_eager,
               row_number() OVER (PARTITION BY ix, iy ORDER BY ts DESC) AS rn
          FROM event_cells
      )
      SELECT ix, iy, count(*)::int AS event_count
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= $5 OR bool_or(public_map_eager)
    `;
  }
  return `
    ${sourceCte()}
    SELECT ix, iy, count(*)::int AS event_count
      FROM event_cells
     GROUP BY ix, iy
    HAVING count(DISTINCT user_id) >= $5 OR bool_or(public_map_eager)
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

  const mode = parseTileMode(new URL(req.url).searchParams.get('mode'));
  const bbox = tileQueryBbox(z, x, y);

  let cells: IncidentCell[];
  try {
    const res = await pool.query<{ ix: number; iy: number; event_count: number }>(
      queryFor(mode),
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
