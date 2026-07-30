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
  parseIncidentNorm,
  parseTileMode,
  parseTilePercentile,
  type IncidentNorm,
  type TileMode,
  type TilePercentile,
} from '@/lib/tile-mode';
import {
  incidentValueExpr,
  INCIDENT_THRESHOLDS,
  splitIncidentCells,
} from '@/lib/incident-tiles';
import {
  ownOtherEventsPredicate,
  parseOwnOtherEventKind,
} from '@/lib/other-event-tiles';
import {
  parseRidesFilter,
  ridesFilterSql,
  type RidesFilter,
} from '@/lib/user-tile-helpers';
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Personal "other events" tile renderer. Mirrors the close-call route
// with a kind axis added.
//
// Unlike the public layer this shows the rider EVERY event they
// logged, custom labels included. "Custom events are owner-only
// forever" restricts cross-account exposure — it was never meant to
// hide a rider's own notes from their own map. The query is scoped to
// r.user_id = $1, and there is no is_public_eligible filter here by
// design.
//
// Query parameters:
//   ?rides=mounted|pocket|all   ride-mode filter; default mounted.
//   ?mode=all|3mo|last10        time window; default all.
//   ?percentile=all|top10|bottom10
//   ?norm=raw|freq              raw = events per cell (default);
//                               freq = events ÷ distinct rides that
//                               touched the cell.
//   ?kind=<kind>|all            any of the rider's own kinds,
//                               built-in or custom; default all.

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, max-age=300',
} as const;

const NOT_FOUND_TILE = (status = 200) =>
  new Response(new Uint8Array(emptyTilePng()), { status, headers: PNG_HEADERS });

// (ride_uuid, ix, iy) pairs the user's rides visited. Grouping by
// (ix, iy) gives "distinct rides through cell" for freq normalization.
function visitedCte(rides: RidesFilter, withBbox: boolean): string {
  const bbox = withBbox
    ? `AND rp.latitude  BETWEEN $2 AND $3
       AND rp.longitude BETWEEN $4 AND $5`
    : '';
  return `
    SELECT DISTINCT
      rp.ride_uuid,
      floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    WHERE r.user_id = $1
      ${ridesFilterSql(rides)}
      ${bbox}
  `;
}

function otherEventMetricsCte(
  rides: RidesFilter,
  mode: TileMode,
  kindParam: string,
): string {
  const timeFilter =
    mode === '3mo' ? "AND oe.timestamp > now() - interval '3 months'" : '';
  const inner = `
    SELECT
      floor(oe.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(oe.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      oe.timestamp AS ts
    FROM other_events oe
    JOIN rides r ON r.ride_uuid = oe.ride_uuid
    WHERE r.user_id = $1
      AND ${ownOtherEventsPredicate(kindParam)}
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
      SELECT ix, iy, count(*)::int AS n
        FROM ranked WHERE rn <= 10
       GROUP BY ix, iy
    `;
  }
  return `
    WITH event_cells AS (${inner})
    SELECT ix, iy, count(*)::int AS n
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
  const norm: IncidentNorm = parseIncidentNorm(sp.get('norm'));
  const kind = parseOwnOtherEventKind(sp.get('kind'));

  const bbox = tileQueryBbox(z, x, y);
  const valueExpr = incidentValueExpr('count', norm);

  let cells: IncidentCell[];
  let haloOnlyCells: ReadonlyArray<{ ix: number; iy: number }> = [];
  try {
    const sql = `
      WITH visited     AS (${visitedCte(rides, true)}),
           ride_counts AS (
             SELECT ix, iy, count(*)::int AS rides
               FROM visited GROUP BY ix, iy
           ),
           metrics     AS (${otherEventMetricsCte(rides, mode, '$6')})
      SELECT cov.ix, cov.iy, ${valueExpr} AS value
        FROM ride_counts cov
        LEFT JOIN metrics m ON m.ix = cov.ix AND m.iy = cov.iy
    `;
    const res = await pool.query<{ ix: number; iy: number; value: number }>(
      sql,
      [session.user.id, bbox.south, bbox.north, bbox.west, bbox.east, kind],
    );
    const allCells: IncidentCell[] = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      value: Number(r.value),
    }));

    if (percentile !== 'all') {
      const threshold = await getOrComputeThreshold(
        `user:other-events:${session.user.id}:${kind ?? 'all'}:${rides}:${mode}:${norm}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            `WITH visited     AS (${visitedCte(rides, false)}),
                  ride_counts AS (
                    SELECT ix, iy, count(*)::int AS rides
                      FROM visited GROUP BY ix, iy
                  ),
                  metrics     AS (${otherEventMetricsCte(rides, mode, '$2')}),
                  values_ AS (
                    SELECT ${valueExpr} AS value
                      FROM ride_counts cov
                      LEFT JOIN metrics m ON m.ix = cov.ix AND m.iy = cov.iy
                  )
             SELECT
               percentile_cont(0.1) WITHIN GROUP (ORDER BY value) AS lo,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY value) AS hi
             FROM values_`,
            [session.user.id, kind],
          );
          const row = r.rows[0];
          if (!row || row.lo == null || row.hi == null) {
            return NO_DATA_THRESHOLD;
          }
          return { lo: Number(row.lo), hi: Number(row.hi) };
        },
      );
      const split = splitIncidentCells(allCells, percentile, threshold);
      cells = split.colored;
      haloOnlyCells = split.haloOnly;
    } else {
      cells = allCells;
    }
  } catch (err) {
    console.error('user other-event tile query failed', err);
    return NOT_FOUND_TILE(500);
  }

  return new Response(
    new Uint8Array(
      renderIncidentTile(z, x, y, cells, INCIDENT_THRESHOLDS.count[norm], haloOnlyCells),
    ),
    { status: 200, headers: PNG_HEADERS },
  );
}
