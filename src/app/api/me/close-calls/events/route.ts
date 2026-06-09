import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { getRequestUserId } from '@/lib/request-auth';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';
import {
  parseRidesFilter,
  ridesFilterSql,
  type RidesFilter,
} from '@/lib/user-tile-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Personal close-call events as GeoJSON. Drives the "Individual events"
// mode on the close-call layer of the personal /bump-map — the
// MapLibre map binds a non-raster GeoJSON source to this URL and
// rebinds it on every viewport change.
//
// Query parameters:
//   ?bbox=west,south,east,north  REQUIRED. Decimal degrees, comma-
//                                separated. ~ one MapLibre viewport.
//   ?rides=mounted|pocket|all    default mounted.
//   ?mode=all|3mo                default all. last10 falls back to
//                                all — "last 10 events per cell"
//                                doesn't read naturally on an
//                                individual-events view.
//
// Response: { type: "FeatureCollection", features: [...] }. Each
// feature is a Point with `properties.timestamp`. No privacy gate
// (the user owns the data).
//
// Hard cap of MAX_EVENTS so a pathological zoom-out doesn't return a
// million features. X-Truncated header surfaces this to the UI so
// it can warn the user.

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
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const bbox = parseBbox(sp.get('bbox'));
  if (!bbox) {
    return NextResponse.json(
      { error: 'invalid bbox; expected west,south,east,north decimal degrees' },
      { status: 400 },
    );
  }
  const rides: RidesFilter = parseRidesFilter(sp.get('rides'));
  const mode: TileMode = parseTileMode(sp.get('mode'));

  try {
    const res = await pool.query<{
      longitude: number;
      latitude: number;
      timestamp: Date;
    }>(
      `SELECT c.longitude, c.latitude, c.timestamp
         FROM close_call_events c
         JOIN rides r ON r.ride_uuid = c.ride_uuid
        WHERE r.user_id = $1
          ${ridesFilterSql(rides)}
          ${timeFilter(mode)}
          AND c.latitude  BETWEEN $2 AND $3
          AND c.longitude BETWEEN $4 AND $5
        ORDER BY c.timestamp DESC
        LIMIT ${MAX_EVENTS + 1}`,
      [userId, bbox.south, bbox.north, bbox.west, bbox.east],
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
          'Cache-Control': 'private, max-age=60',
          'X-Total-Returned': String(features.length),
          'X-Truncated': truncated ? 'true' : 'false',
        },
      },
    );
  } catch (err) {
    console.error('user close-call events query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
