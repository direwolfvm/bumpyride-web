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
  parsePublicOtherEventKind,
  publicOtherEventsPredicate,
} from '@/lib/other-event-tiles';
import { getOrComputeThreshold, NO_DATA_THRESHOLD } from '@/lib/percentile-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public "other events" tile renderer — the community layer for
// built-in event kinds (Blocked Lane today). Same shape as the
// close-call route: a per-cell count with raw/freq normalization,
// behind the same privacy gate.
//
// Query parameters:
//   ?mode=all|3mo|last10        time window on the events.
//   ?percentile=all|top10|bottom10
//   ?norm=raw|freq              raw (default) or count ÷ distinct
//                               rides that touched the cell.
//   ?kind=<registry kind>|all   which built-in kind to render;
//                               default all built-in kinds.
//
// TWO independent privacy layers, both required:
//   1. Per-event: only rows with is_public_eligible (registry kind AND
//      the client marked it built-in). Custom labels — a rider's own
//      words — are never publishable, and registry skew degrades
//      toward privacy. Enforced via publicOtherEventsPredicate so this
//      route can't drift from the rule.
//   2. Per-cell: the ≥3-distinct-sharing-users gate (or any one
//      contributor with public_map_eager) that every public layer
//      uses, so a single rider's report can't be localized.
//
// See ./close-calls/.../route.ts for the shared design rationale and
// bumpy-ride/docs/OTHER_EVENTS_WEB_HANDOFF.md for the privacy model.

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

// Coverage denominator. norm=raw uses the cheap maintained aggregate;
// norm=freq re-aggregates ride_points for a "distinct rides through
// cell" count. Same gate either way.
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

// Per-cell event counts. `kindParam` is the placeholder for the bound
// kind argument. The is_public_eligible filter rides inside
// publicOtherEventsPredicate — see the header note.
function otherEventMetricsCte(mode: TileMode, kindParam: string): string {
  const filter =
    mode === '3mo' ? "AND oe.timestamp > now() - interval '3 months'" : '';
  const sourceCte = `
    SELECT
      floor(oe.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
      floor(oe.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
      r.user_id,
      u.public_map_eager,
      oe.timestamp AS ts
    FROM other_events oe
    JOIN rides r ON r.ride_uuid = oe.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE u.share_to_public_map = TRUE
      AND r.pocket_mode IS DISTINCT FROM TRUE
      AND ${publicOtherEventsPredicate(kindParam)}
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
      SELECT ix, iy, count(*)::int AS n
        FROM ranked
       WHERE rn <= 10
       GROUP BY ix, iy
      HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS} OR bool_or(public_map_eager)
    `;
  }
  return `
    WITH event_cells AS (${sourceCte})
    SELECT ix, iy, count(*)::int AS n
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
  const norm: IncidentNorm = parseIncidentNorm(url.searchParams.get('norm'));
  const kind = parsePublicOtherEventKind(url.searchParams.get('kind'));
  const bbox = tileQueryBbox(z, x, y);

  const ixMin = Math.floor(bbox.west / CELL_LON_DEG);
  const ixMax = Math.floor(bbox.east / CELL_LON_DEG);
  const iyMin = Math.floor(bbox.south / CELL_LAT_DEG);
  const iyMax = Math.floor(bbox.north / CELL_LAT_DEG);

  const valueExpr = incidentValueExpr('count', norm);

  let cells: IncidentCell[];
  let haloOnlyCells: ReadonlyArray<{ ix: number; iy: number }> = [];
  try {
    const bboxSql = `
      WITH coverage AS (${coverageCte(norm)}),
           metrics  AS (${otherEventMetricsCte(mode, '$5')})
      SELECT cov.ix, cov.iy, ${valueExpr} AS value
        FROM coverage cov
        LEFT JOIN metrics m ON m.ix = cov.ix AND m.iy = cov.iy
       WHERE cov.ix BETWEEN $1 AND $2
         AND cov.iy BETWEEN $3 AND $4
    `;
    const res = await pool.query<{ ix: number; iy: number; value: number }>(
      bboxSql,
      [ixMin, ixMax, iyMin, iyMax, kind],
    );
    const allCells: IncidentCell[] = res.rows.map((r) => ({
      ix: Number(r.ix),
      iy: Number(r.iy),
      value: Number(r.value),
    }));

    if (percentile !== 'all') {
      const threshold = await getOrComputeThreshold(
        `public:other-events:${kind ?? 'all'}:${mode}:${norm}`,
        async (client) => {
          const r = await client.query<{ lo: number | null; hi: number | null }>(
            `WITH coverage AS (${coverageCte(norm)}),
                  metrics  AS (${otherEventMetricsCte(mode, '$1')}),
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
            [kind],
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
    console.error('public other-event tile query failed', err);
    return respondTile(emptyTilePng(), 500);
  }

  return respondTile(
    renderIncidentTile(z, x, y, cells, INCIDENT_THRESHOLDS.count[norm], haloOnlyCells),
  );
}
