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
  parseIncidentMetric,
  parseIncidentNorm,
  parseTileMode,
  parseTilePercentile,
  type IncidentMetric,
  type IncidentNorm,
  type TileMode,
  type TilePercentile,
} from '@/lib/tile-mode';
import {
  brakeMetricsAgg,
  incidentValueExpr,
  INCIDENT_THRESHOLDS,
} from '@/lib/incident-tiles';
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
// to the ?rides= filter). Renders as value=0 (green) when the user
// has bump coverage but no brake events in that cell.
//
// Brake metrics: LEFT-JOINed in, respecting the time-window mode.
//
// Query parameters:
//   ?rides=mounted|pocket|all   ride-mode filter; default mounted.
//   ?mode=all|3mo|last10        time window; default all.
//   ?percentile=all|top10|bottom10
//   ?metric=count|intensity     count = events per cell (default);
//                               intensity = Σ(peak g × duration).
//   ?norm=raw|freq              raw = displayed value is the metric
//                               directly; freq = metric ÷ distinct
//                               rides that touched the cell.

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, max-age=300',
} as const;

const NOT_FOUND_TILE = (status = 200) =>
  new Response(new Uint8Array(emptyTilePng()), { status, headers: PNG_HEADERS });

// (ride_uuid, ix, iy) pairs that visited the cell. Grouping by
// (ix, iy) and counting gives the "distinct rides through cell"
// denominator the freq normalization needs. For norm=raw we still
// use it as the coverage source (every cell here gets rendered;
// brake metrics LEFT-JOIN on top).
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

function brakeMetricsCte(rides: RidesFilter, mode: TileMode): string {
  const timeFilter =
    mode === '3mo' ? "AND b.timestamp > now() - interval '3 months'" : '';
  const inner = `
    SELECT
      floor(b.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(b.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      b.peak_deceleration_mps2,
      b.duration_seconds,
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
             SELECT *,
                    row_number() OVER (PARTITION BY ix, iy ORDER BY ts DESC) AS rn
               FROM event_cells
           ),
           recent AS (SELECT * FROM ranked WHERE rn <= 10)
      SELECT ix, iy, ${brakeMetricsAgg('recent')}
        FROM recent GROUP BY ix, iy
    `;
  }
  return `
    WITH event_cells AS (${inner})
    SELECT ix, iy, ${brakeMetricsAgg('event_cells')}
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
  const metric: IncidentMetric = parseIncidentMetric(sp.get('metric'));
  const norm: IncidentNorm = parseIncidentNorm(sp.get('norm'));

  const bbox = tileQueryBbox(z, x, y);
  const valueExpr = incidentValueExpr(metric, norm);

  let cells: IncidentCell[];
  try {
    const sql = `
      WITH visited     AS (${visitedCte(rides, true)}),
           ride_counts AS (
             SELECT ix, iy, count(*)::int AS rides
               FROM visited GROUP BY ix, iy
           ),
           metrics     AS (${brakeMetricsCte(rides, mode)})
      SELECT cov.ix, cov.iy, ${valueExpr} AS value
        FROM ride_counts cov
        LEFT JOIN metrics m ON m.ix = cov.ix AND m.iy = cov.iy
    `;
    const res = await pool.query<{ ix: number; iy: number; value: number }>(
      sql,
      [session.user.id, bbox.south, bbox.north, bbox.west, bbox.east],
    );
    cells = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      value: Number(r.value),
    }));

    if (percentile !== 'all') {
      const threshold = await getOrComputeThreshold(
        `user:brakes:${session.user.id}:${rides}:${mode}:${metric}:${norm}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            // No-bbox version of the same CTE chain. Computes the
            // 10/90 cutoffs across every cell the user has, scoped
            // to (rides, mode, metric, norm).
            `WITH visited     AS (${visitedCte(rides, false)}),
                  ride_counts AS (
                    SELECT ix, iy, count(*)::int AS rides
                      FROM visited GROUP BY ix, iy
                  ),
                  metrics     AS (${brakeMetricsCte(rides, mode)}),
                  values_ AS (
                    SELECT ${valueExpr} AS value
                      FROM ride_counts cov
                      LEFT JOIN metrics m ON m.ix = cov.ix AND m.iy = cov.iy
                  )
             SELECT
               percentile_cont(0.1) WITHIN GROUP (ORDER BY value) AS lo,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY value) AS hi
             FROM values_`,
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
        if (c.value <= 0) return false;
        return percentile === 'top10'
          ? c.value <= threshold.lo
          : c.value >= threshold.hi;
      });
    }
  } catch (err) {
    console.error('user brake tile query failed', err);
    return NOT_FOUND_TILE(500);
  }

  return new Response(
    new Uint8Array(
      renderIncidentTile(z, x, y, cells, INCIDENT_THRESHOLDS[metric][norm]),
    ),
    { status: 200, headers: PNG_HEADERS },
  );
}
