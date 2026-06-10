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
  splitIncidentCells,
} from '@/lib/incident-tiles';
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
// Query parameters:
//   ?mode=all|3mo|last10        time window on brake events.
//   ?percentile=all|top10|bottom10
//   ?metric=count|intensity     count (default) or Σ(peak g × duration).
//   ?norm=raw|freq              raw (default) or value ÷ distinct
//                               rides that touched the cell.
//
// Brake values: LEFT-JOINed in, computed against ONLY brake events
// whose contributors pass the brake-specific gate. Cells where bump
// coverage exists but brake events don't pass the gate render as
// value=0 — green tier — which keeps single-user brake data from
// leaking via a "1-event" reveal.
//
// For norm=freq we replace the cheap bump_cells coverage with a
// re-aggregation from ride_points so we have the "distinct rides
// through cell" denominator. Slower, but only paid when the user
// opts into the freq toggle.

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

// Bump-coverage cells (privacy-gated bumpiness cells). Used for the
// fast norm=raw path. For norm=freq we use the rideCountsCte instead.
const BUMP_COVERAGE_CTE = `
  SELECT bc.ix, bc.iy, 1::int AS rides
    FROM bump_cells bc
   WHERE EXISTS (
     SELECT 1
       FROM bump_cell_contributors bcc
       JOIN users u ON u.id = bcc.user_id
      WHERE bcc.ix = bc.ix AND bcc.iy = bc.iy
     HAVING count(*) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(u.public_map_eager)
   )
`;

// Re-aggregated ride counts per cell. Drops the bump_cells fast path
// in exchange for the "rides through cell" denominator. Same privacy
// gate as bump_cells (3+ distinct users with sharing-on bumpiness
// data, or eager).
const RIDE_COUNTS_CTE = `
  WITH visited AS (
    SELECT DISTINCT
      rp.ride_uuid,
      floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      r.user_id,
      u.public_map_eager
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE u.share_to_public_map = TRUE
      AND r.pocket_mode IS DISTINCT FROM TRUE
  )
  SELECT ix, iy, count(*)::int AS rides
    FROM visited
   GROUP BY ix, iy
  HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
`;

function coverageCte(norm: IncidentNorm): string {
  return norm === 'freq' ? RIDE_COUNTS_CTE : BUMP_COVERAGE_CTE;
}

// Brake metrics per cell, applying the brake-specific privacy gate
// and the time-window mode. Cells with no gate-passing brake events
// don't appear in this CTE — they LEFT-JOIN against the coverage set
// and surface as value=0.
function brakeMetricsCte(mode: TileMode): string {
  const filter =
    mode === '3mo' ? "AND b.timestamp > now() - interval '3 months'" : '';
  const sourceCte = `
    SELECT
      floor(b.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(b.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      r.user_id,
      u.public_map_eager,
      b.peak_deceleration_mps2,
      b.duration_seconds,
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
             SELECT *,
                    row_number() OVER (PARTITION BY ix, iy ORDER BY ts DESC) AS rn
               FROM event_cells
           ),
           recent AS (SELECT * FROM ranked WHERE rn <= 10)
      SELECT ix, iy, ${brakeMetricsAgg('recent')}
        FROM recent
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
    `;
  }
  return `
    WITH event_cells AS (${sourceCte})
    SELECT ix, iy, ${brakeMetricsAgg('event_cells')}
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
  const metric: IncidentMetric = parseIncidentMetric(url.searchParams.get('metric'));
  const norm: IncidentNorm = parseIncidentNorm(url.searchParams.get('norm'));
  const bbox = tileQueryBbox(z, x, y);

  const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
  const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
  const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
  const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);

  const valueExpr = incidentValueExpr(metric, norm);

  let cells: IncidentCell[];
  let haloOnlyCells: ReadonlyArray<{ ix: number; iy: number }> = [];
  try {
    const bboxSql = `
      WITH coverage AS (${coverageCte(norm)}),
           metrics  AS (${brakeMetricsCte(mode)})
      SELECT cov.ix, cov.iy, ${valueExpr} AS value
        FROM coverage cov
        LEFT JOIN metrics m ON m.ix = cov.ix AND m.iy = cov.iy
       WHERE cov.ix BETWEEN $1 AND $2
         AND cov.iy BETWEEN $3 AND $4
    `;
    const res = await pool.query<{ ix: number; iy: number; value: number }>(
      bboxSql,
      [ixMin, ixMax, iyMin, iyMax],
    );
    const allCells: IncidentCell[] = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      value: Number(r.value),
    }));

    if (percentile !== 'all') {
      // Cutoffs are computed over gate-passing cells with a non-zero
      // metric (i.e., value > 0). Including the zero-coverage cells
      // would swamp the distribution. Cache key includes every axis
      // that changes the metric set.
      const threshold = await getOrComputeThreshold(
        `public:brakes:${mode}:${metric}:${norm}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            `WITH coverage AS (${coverageCte(norm)}),
                  metrics  AS (${brakeMetricsCte(mode)}),
                  values_ AS (
                    SELECT ${valueExpr} AS value
                      FROM coverage cov
                      LEFT JOIN metrics m ON m.ix = cov.ix AND m.iy = cov.iy
                     WHERE m.n IS NOT NULL
                  )
             SELECT
               percentile_cont(0.1) WITHIN GROUP (ORDER BY value) AS lo,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY value) AS hi
             FROM values_`,
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
    console.error('public brake tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(
    renderIncidentTile(z, x, y, cells, INCIDENT_THRESHOLDS[metric][norm], haloOnlyCells),
  );
}
