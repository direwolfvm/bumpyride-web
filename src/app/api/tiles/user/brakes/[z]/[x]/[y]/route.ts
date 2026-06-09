import { NextRequest } from 'next/server';
import { auth } from '@/auth';
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
import {
  parseRidesFilter,
  ridesFilterSql,
  type RidesFilter,
} from '@/lib/user-tile-helpers';
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Personal brake-event tile renderer. Mirrors the public brake route
// shape but against the authenticated user's own data — no privacy
// gate, since these are the user's own brakes.
//
// Coverage cells: every cell the user has ride_points in (subject
// to the ?rides= filter). Renders as count=0 (green) when the user
// has bump coverage but no brake events in that cell.
//
// Brake counts: LEFT-JOINed in, respecting the time-window mode.
//
// Query parameters match the public route, with the additional
// ?rides=mounted|pocket|all from the personal map.

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, max-age=300',
} as const;

const NOT_FOUND_TILE = (status = 200) =>
  new Response(new Uint8Array(emptyTilePng()), { status, headers: PNG_HEADERS });

function coverageCte(rides: RidesFilter): string {
  // Distinct (ix, iy) over the user's ride_points in this bbox,
  // subject to the rides filter. Uses the ride_points (longitude,
  // latitude) index added in migration 0011.
  return `
    SELECT DISTINCT
      floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    WHERE r.user_id = $1
      ${ridesFilterSql(rides)}
      AND rp.latitude  BETWEEN $2 AND $3
      AND rp.longitude BETWEEN $4 AND $5
  `;
}

function brakeCountsCte(rides: RidesFilter, mode: TileMode): string {
  const timeFilter =
    mode === '3mo' ? "AND b.timestamp > now() - interval '3 months'" : '';
  const inner = `
    SELECT
      floor(b.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(b.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      b.timestamp AS ts
    FROM brake_events b
    JOIN rides r ON r.ride_uuid = b.ride_uuid
    WHERE r.user_id = $1
      ${ridesFilterSql(rides)}
      ${timeFilter}
  `;
  if (mode === 'last10') {
    return `
      WITH event_cells AS (${inner}),
           ranked AS (
             SELECT ix, iy,
                    row_number() OVER (PARTITION BY ix, iy ORDER BY ts DESC) AS rn
               FROM event_cells
           )
      SELECT ix, iy, count(*)::int AS count
        FROM ranked WHERE rn <= 10
       GROUP BY ix, iy
    `;
  }
  return `
    WITH event_cells AS (${inner})
    SELECT ix, iy, count(*)::int AS count
      FROM event_cells GROUP BY ix, iy
  `;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
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

  const sp = req.nextUrl.searchParams;
  const rides: RidesFilter = parseRidesFilter(sp.get('rides'));
  const mode: TileMode = parseTileMode(sp.get('mode'));
  const percentile: TilePercentile = parseTilePercentile(sp.get('percentile'));

  const bbox = tileQueryBbox(z, x, y);

  let cells: IncidentCell[];
  try {
    const sql = `
      WITH coverage AS (${coverageCte(rides)}),
           counts   AS (${brakeCountsCte(rides, mode)})
      SELECT cov.ix, cov.iy, COALESCE(cnt.count, 0)::int AS count
        FROM coverage cov
        LEFT JOIN counts cnt ON cnt.ix = cov.ix AND cnt.iy = cov.iy
    `;
    const res = await pool.query<{ ix: number; iy: number; count: number }>(
      sql,
      [session.user.id, bbox.south, bbox.north, bbox.west, bbox.east],
    );
    cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      count: Number(r.count),
    }));

    if (percentile !== 'all') {
      const threshold = await getOrComputeThreshold(
        `user:brakes:${session.user.id}:${rides}:${mode}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            // The counts CTE already lacks a bbox filter — same SQL
            // for per-tile and threshold paths, just wrapped here.
            `WITH counts AS (${brakeCountsCte(rides, mode)})
             SELECT
               percentile_cont(0.1) WITHIN GROUP (ORDER BY count) AS lo,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY count) AS hi
             FROM counts`,
            [session.user.id],
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
    console.error('user brake tile query failed', err);
    return NOT_FOUND_TILE(500);
  }

  return new Response(new Uint8Array(renderIncidentTile(z, x, y, cells)), {
    status: 200,
    headers: PNG_HEADERS,
  });
}
