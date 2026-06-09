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

// Public brake-event tile renderer.
//
// Coverage cells: every cell that passes the BUMPINESS privacy gate
// (3+ distinct bumpiness contributors OR one with public_map_eager)
// gets rendered, so the brake layer is visually complete — you see
// every cell the bumpiness layer shows, colored by brake activity.
//
// Brake counts: LEFT-JOINed in, computed against ONLY brake events
// whose contributors pass the brake-specific gate. Cells where bump
// coverage exists but brake events don't pass the gate (e.g. only
// one rider has braked there) render as count=0 — green tier in the
// new cells renderer — which keeps single-user brake data from
// leaking via a "1-event" reveal.
//
// ?mode=all|3mo|last10 applies to the brake-event time window.
// Bump coverage is always lifetime (gates from bump_cells), so a
// brake mode-filter change just re-buckets the colors, never the
// cell set.
//
// ?percentile=all|top10|bottom10 operates on brake-gate-passing
// cells only (count > 0). With percentile=top10/bottom10 we filter
// the rendered cells to that bucket — coverage cells with count=0
// drop out so the rendered set matches the percentile semantics.

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

// Bump-coverage cells (privacy-gated bumpiness cells). No bbox here —
// applied by the outer SELECT. Cheap because bump_cells is indexed
// and the EXISTS gate uses the contributors PK.
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

// Brake counts per cell, applying the brake-specific privacy gate
// and the time-window mode. Cells with no gate-passing brake events
// don't appear in this CTE — they'll be LEFT-JOINed against the
// coverage set and surface as count=0.
function brakeCountsCte(mode: TileMode): string {
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
    // Coverage cells in this tile's bbox, with brake counts joined
    // in. COALESCE the LEFT JOIN to 0 so cells without brake gate
    // passing surface explicitly as the green "no incidents" tier.
    const bboxSql = `
      WITH coverage AS (${BUMP_COVERAGE_CTE}),
           counts   AS (${brakeCountsCte(mode)})
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
      // Percentile thresholds are computed over the BRAKE-gate-passing
      // cells only (i.e. count > 0) — including all the zero-coverage
      // cells would swamp the distribution. When the user picks a
      // percentile bucket, we drop zero-coverage cells from the
      // render entirely.
      const threshold = await getOrComputeThreshold(
        `public:brakes:${mode}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            `WITH counts AS (${brakeCountsCte(mode)})
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
    console.error('public brake tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(renderIncidentTile(z, x, y, cells));
}
