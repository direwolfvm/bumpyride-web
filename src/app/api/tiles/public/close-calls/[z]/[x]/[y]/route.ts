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
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public close-call tile renderer. Same shape as the brake route:
//
//   Coverage cells = bumpiness-gate-passing cells (always lifetime).
//   Close-call counts LEFT-JOINed in; cells without close-call gate
//   passing render as count=0 (green tier) so single-user close-call
//   data isn't leaked.
//
// See ./brakes/.../route.ts for the design rationale.

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

const BUMP_COVERAGE_CTE = `
  SELECT bc.ix, bc.iy
    FROM bump_cells bc
   WHERE EXISTS (
     SELECT 1
       FROM bump_cell_contributors bcc
       JOIN users u ON u.id = bcc.user_id
      WHERE bcc.ix = bc.ix AND bcc.iy = bc.iy
     HAVING count(*) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(u.public_map_eager)
   )
`;

function closeCallCountsCte(mode: TileMode): string {
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

  const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
  const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
  const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
  const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);

  let cells: IncidentCell[];
  try {
    const bboxSql = `
      WITH coverage AS (${BUMP_COVERAGE_CTE}),
           counts   AS (${closeCallCountsCte(mode)})
      SELECT cov.ix, cov.iy, COALESCE(cnt.count, 0)::int AS count
        FROM coverage cov
        LEFT JOIN counts cnt ON cnt.ix = cov.ix AND cnt.iy = cov.iy
       WHERE cov.ix BETWEEN $1 AND $2
         AND cov.iy BETWEEN $3 AND $4
    `;
    const res = await pool.query<{ ix: number; iy: number; count: number }>(
      bboxSql,
      [ixMin, ixMax, iyMin, iyMax],
    );
    cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      count: Number(r.count),
    }));

    if (percentile !== 'all') {
      const threshold = await getOrComputeThreshold(
        `public:close-calls:${mode}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            `WITH counts AS (${closeCallCountsCte(mode)})
             SELECT
               percentile_cont(0.1) WITHIN GROUP (ORDER BY count) AS lo,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY count) AS hi
             FROM counts`,
          );
          const row = r.rows[0];
          if (!row || row.lo == null || row.hi == null) {
            return NO_DATA_THRESHOLD;
          }
          return { lo: Number(row.lo), hi: Number(row.hi) };
        },
      );
      cells = cells.filter((c) => {
        if (c.count <= 0) return false;
        return percentile === 'top10'
          ? c.count <= threshold.lo
          : c.count >= threshold.hi;
      });
    }
  } catch (err) {
    console.error('public close-call tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderIncidentTile(z, x, y, cells));
}
