import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';
import {
  parsePublicOtherEventKind,
  publicOtherEventsPredicate,
} from '@/lib/other-event-tiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public "other events" as GeoJSON. Drives the "Individual events"
// mode on the other-events layer of the public /map.
//
// Two privacy layers, both required (same as the raster route):
//   1. Per-event: is_public_eligible only — a rider's custom label is
//      never published, and registry skew degrades toward privacy.
//   2. Per-cell: the containing cell must pass the ≥3-distinct-users
//      gate (or carry a public_map_eager contributor). Without it a
//      single rider's blocked-lane report would be exposed at a
//      verbatim lat/lon — considerably worse for privacy than the
//      aggregate count layer.
//
// `kind` rides along as a feature property so the client can style or
// filter per kind once the registry grows past blocked-lane.

const MIN_PUBLIC_CELL_USERS = Math.max(
  1,
  Number.parseInt(
    process.env.PUBLIC_BUMPMAP_MIN_USERS ??
      process.env.PUBLIC_BUMPMAP_MIN_COUNT ??
      '3',
    10,
  ) || 3,
);

const MAX_EVENTS = 5000;

type Bbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

function parseBbox(raw: string | null): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  return { west, south, east, north };
}

function timeFilter(mode: TileMode): string {
  return mode === '3mo' ? "AND oe.timestamp > now() - interval '3 months'" : '';
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bbox = parseBbox(sp.get('bbox'));
  if (!bbox) {
    return NextResponse.json(
      { error: 'invalid bbox; expected west,south,east,north decimal degrees' },
      { status: 400 },
    );
  }
  const mode: TileMode = parseTileMode(sp.get('mode'));
  const kind = parsePublicOtherEventKind(sp.get('kind'));

  try {
    // Two-stage query, mirroring the close-call events route:
    //   1) passing_cells — every (ix, iy) where the gate passes,
    //      computed across the whole dataset for the chosen mode (not
    //      bbox-restricted) so gate semantics match the raster route.
    //   2) events — publishable events inside the bbox whose cell is
    //      in passing_cells.
    const res = await pool.query<{
      longitude: number;
      latitude: number;
      timestamp: Date;
      kind: string;
    }>(
      `WITH gate AS (
         SELECT
           floor(oe.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
           floor(oe.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
           r.user_id,
           u.public_map_eager
         FROM other_events oe
         JOIN rides r ON r.ride_uuid = oe.ride_uuid
         JOIN users u ON u.id = r.user_id
         WHERE u.share_to_public_map = TRUE
           AND r.pocket_mode IS DISTINCT FROM TRUE
           AND ${publicOtherEventsPredicate('$5')}
           ${timeFilter(mode)}
       ),
       passing_cells AS (
         SELECT ix, iy
           FROM gate
          GROUP BY ix, iy
         HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS}
             OR bool_or(public_map_eager)
       )
       SELECT oe.longitude, oe.latitude, oe.timestamp, oe.kind
         FROM other_events oe
         JOIN rides r ON r.ride_uuid = oe.ride_uuid
         JOIN users u ON u.id = r.user_id
        WHERE u.share_to_public_map = TRUE
          AND r.pocket_mode IS DISTINCT FROM TRUE
          AND ${publicOtherEventsPredicate('$5')}
          ${timeFilter(mode)}
          AND oe.latitude  BETWEEN $1 AND $2
          AND oe.longitude BETWEEN $3 AND $4
          AND EXISTS (
            SELECT 1 FROM passing_cells pc
             WHERE pc.ix = floor(oe.longitude / ${CELL_LON_DEG}::float8)::int
               AND pc.iy = floor(oe.latitude  / ${CELL_LAT_DEG}::float8)::int
          )
        ORDER BY oe.timestamp DESC
        LIMIT ${MAX_EVENTS + 1}`,
      [bbox.south, bbox.north, bbox.west, bbox.east, kind],
    );

    const truncated = res.rows.length > MAX_EVENTS;
    const features = res.rows.slice(0, MAX_EVENTS).map((r) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [Number(r.longitude), Number(r.latitude)],
      },
      properties: {
        timestamp: r.timestamp.toISOString(),
        kind: r.kind,
      },
    }));

    return NextResponse.json(
      { type: 'FeatureCollection', features },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300',
          'X-Total-Returned': String(features.length),
          'X-Truncated': truncated ? 'true' : 'false',
        },
      },
    );
  } catch (err) {
    console.error('public other-event events query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
