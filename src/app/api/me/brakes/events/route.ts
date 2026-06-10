import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { G_MPS2 } from '@/lib/incident-tiles';
import { getRequestUserId } from '@/lib/request-auth';
import { parseTileMode, type TileMode } from '@/lib/tile-mode';
import {
  parseRidesFilter,
  ridesFilterSql,
  type RidesFilter,
} from '@/lib/user-tile-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Personal brake events as GeoJSON. Mirrors the close-call events
// route — see ../../close-calls/events/route.ts for the full design
// notes. Differs only in:
//   - source table: brake_events (not close_call_events)
//   - extra per-feature properties: peakG + durationSeconds, so the
//     marker layer can color by intensity or filter by severity
//
// Query parameters:
//   ?bbox=west,south,east,north  REQUIRED. Decimal degrees.
//   ?rides=mounted|pocket|all    default mounted.
//   ?mode=all|3mo                default all. last10 falls back to all.

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
  return mode === '3mo' ? "AND b.timestamp > now() - interval '3 months'" : '';
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
      peak_g: number;
      duration_seconds: number;
    }>(
      `SELECT
         b.longitude,
         b.latitude,
         b.timestamp,
         (b.peak_deceleration_mps2 / ${G_MPS2})::float8 AS peak_g,
         b.duration_seconds
         FROM brake_events b
         JOIN rides r ON r.ride_uuid = b.ride_uuid
        WHERE r.user_id = $1
          ${ridesFilterSql(rides)}
          ${timeFilter(mode)}
          AND b.latitude  BETWEEN $2 AND $3
          AND b.longitude BETWEEN $4 AND $5
        ORDER BY b.timestamp DESC
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
        peakG: Number(r.peak_g),
        durationSeconds: Number(r.duration_seconds),
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
    console.error('user brake events query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
