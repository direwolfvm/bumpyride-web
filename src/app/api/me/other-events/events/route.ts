import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { getRequestUserId } from '@/lib/request-auth';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';
import {
  ownOtherEventsPredicate,
  parseOwnOtherEventKind,
} from '@/lib/other-event-tiles';
import {
  parseRidesFilter,
  ridesFilterSql,
  type RidesFilter,
} from '@/lib/user-tile-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Personal "other events" as GeoJSON. Drives the "Individual events"
// mode on the other-events layer of the personal /bump-map.
//
// No privacy gate and no is_public_eligible filter — the rider owns
// this data, so their custom labels appear here (and only here). Each
// feature carries `kind` and `isCustom` so the map can label markers
// and visually distinguish a rider's own notes from the community
// built-ins.
//
// Query parameters:
//   ?bbox=west,south,east,north  REQUIRED. Decimal degrees.
//   ?rides=mounted|pocket|all    default mounted.
//   ?mode=all|3mo                default all; last10 falls back to
//                                all (per-cell recency doesn't read
//                                naturally on an events view).
//   ?kind=<kind>|all             any of the rider's own kinds.

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
  const kind = parseOwnOtherEventKind(sp.get('kind'));

  try {
    const res = await pool.query<{
      longitude: number;
      latitude: number;
      timestamp: Date;
      kind: string;
      is_custom: boolean;
    }>(
      `SELECT oe.longitude, oe.latitude, oe.timestamp, oe.kind, oe.is_custom
         FROM other_events oe
         JOIN rides r ON r.ride_uuid = oe.ride_uuid
        WHERE r.user_id = $1
          AND ${ownOtherEventsPredicate('$6')}
          ${ridesFilterSql(rides)}
          ${timeFilter(mode)}
          AND oe.latitude  BETWEEN $2 AND $3
          AND oe.longitude BETWEEN $4 AND $5
        ORDER BY oe.timestamp DESC
        LIMIT ${MAX_EVENTS + 1}`,
      [userId, bbox.south, bbox.north, bbox.west, bbox.east, kind],
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
        isCustom: r.is_custom,
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
    console.error('user other-event events query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
