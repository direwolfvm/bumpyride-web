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
} from '@/lib/tile-mode';
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public brake-event tile renderer. See ./close-calls/.../route.ts
// and the public bumpiness route at /api/tiles/public/[z]/[x]/[y]
// for the design rationale shared between all three layers.
//
// Accepts ?mode=all|3mo|last10 and ?percentile=all|top10|bottom10.
// percentile is computed across gate-passing cells globally and
// memoised in src/lib/percentile-cache.ts — the per-tile query just
// pulls the gate-passing cells in this tile's bbox and filters
// against the cached (lo, hi) cutoffs in JS. Same pattern as the
// personal user tile route's hotfix from PR #36.

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

// CTE producing every gate-passing cell for the given mode. No bbox
// filter — both the per-tile query and the threshold compute apply
// the bbox in their outer SELECTs (or skip it, in the case of the
// global threshold).
function cellsCteSource(mode: TileMode): string {
  const filter =
    mode === '3mo' ? "AND b.timestamp > now() - interval '3 months'" : '';
  const sourceCte = `
    SELECT
      floor(b.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(b.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      r.user_id,
      u.public_map_eager,
      b.timestamp AS ts
    FROM brake_events b
    JOIN rides r ON r.ride_uuid = b.ride_uuid
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
  const mode = parseTileMode(url.searchParams.get('mode'));
  const percentile = parseTilePercentile(url.searchParams.get('percentile'));
  const bbox = tileQueryBbox(z, x, y);

  const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
  const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
  const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
  const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);

  let cells: IncidentCell[];
  try {
    // Same bbox query for every percentile, threshold applied in JS
    // when needed. The cells CTE itself doesn't depend on bbox or
    // percentile, so cold-path scans the gate-passing set once per
    // tile — same cost as the prior `?percentile=all` path.
    const bboxSql = `
      WITH cells AS (${cellsCteSource(mode)})
      SELECT ix, iy, count
        FROM cells
       WHERE ix BETWEEN $1 AND $2
         AND iy BETWEEN $3 AND $4
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
        `public:brakes:${mode}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            `WITH cells AS (${cellsCteSource(mode)})
             SELECT
               percentile_cont(0.1) WITHIN GROUP (ORDER BY count) AS lo,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY count) AS hi
             FROM cells`,
          );
          const row = r.rows[0];
          if (!row || row.lo == null || row.hi == null) {
            return NO_DATA_THRESHOLD;
          }
          return { lo: Number(row.lo), hi: Number(row.hi) };
        },
      );
      cells = cells.filter((c) =>
        percentile === 'top10' ? c.count <= threshold.lo : c.count >= threshold.hi,
      );
    }
  } catch (err) {
    console.error('public brake tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderIncidentTile(z, x, y, cells));
}
