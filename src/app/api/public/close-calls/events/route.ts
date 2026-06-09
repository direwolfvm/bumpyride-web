import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public close-call events as GeoJSON. Drives the "Individual events"
// mode on the close-call layer of the public /map.
//
// Privacy gate: an event is only emitted if its containing cell
// passes the close-call cell gate (≥3 distinct sharing users with
// close-call events in that cell, OR any one with public_map_eager).
// Same rule the raster close-call tile uses for the count metric.
//
// Without this gate, a single rider's close call at a specific lat,
// lon would be exposed verbatim — far worse for privacy than the
// aggregate count layer.

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
  return mode === '3mo' ? "AND c.timestamp > now() - interval '3 months'" : '';
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

  try {
    // Two-stage query:
    //   1) passing_cells: every (ix, iy) where the close-call gate
    //      passes. Computed across the WHOLE dataset for the chosen
    //      mode (not bbox-restricted) so the gate semantics match
    //      the raster route. The set is small enough to compute on
    //      demand.
    //   2) events: every close-call event in the requested bbox
    //      whose containing cell is in passing_cells.
    const res = await pool.query<{
      longitude: number;
      latitude: number;
      timestamp: Date;
    }>(
      `WITH gate AS (
         SELECT
           floor(c.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
           floor(c.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
           r.user_id,
           u.public_map_eager
         FROM close_call_events c
         JOIN rides r ON r.ride_uuid = c.ride_uuid
         JOIN users u ON u.id = r.user_id
         WHERE u.share_to_public_map = TRUE
           AND r.pocket_mode IS DISTINCT FROM TRUE
           ${timeFilter(mode)}
       ),
       passing_cells AS (
         SELECT ix, iy
           FROM gate
          GROUP BY ix, iy
         HAVING count(DISTINCT user_id) >= ${MIN_PUBLIC_CELL_USERS}
             OR bool_or(public_map_eager)
       )
       SELECT c.longitude, c.latitude, c.timestamp
         FROM close_call_events c
         JOIN rides r ON r.ride_uuid = c.ride_uuid
         JOIN users u ON u.id = r.user_id
        WHERE u.share_to_public_map = TRUE
          AND r.pocket_mode IS DISTINCT FROM TRUE
          ${timeFilter(mode)}
          AND c.latitude  BETWEEN $1 AND $2
          AND c.longitude BETWEEN $3 AND $4
          AND EXISTS (
            SELECT 1 FROM passing_cells pc
             WHERE pc.ix = floor(c.longitude / ${CELL_LON_DEG}::float8)::int
               AND pc.iy = floor(c.latitude  / ${CELL_LAT_DEG}::float8)::int
          )
        ORDER BY c.timestamp DESC
        LIMIT ${MAX_EVENTS + 1}`,
      [bbox.south, bbox.north, bbox.west, bbox.east],
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
    console.error('public close-call events query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
