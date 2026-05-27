import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { brakeEvents, closeCallEvents, ridePoints, rides } from '@/db/schema';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-ride JSON export. The shape matches the iOS-side ride schema
// (bumpyride/docs/SCHEMA.md v3) so an export can be parsed by anyone
// who already understands ride payloads — and, in particular, would
// round-trip cleanly through /api/sync/ride if anyone wanted to
// re-ingest it.
//
// Session OR bearer auth so the iOS app can export a ride from its
// own UI using the same token it uses for sync.

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'ride';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ride: string }> },
) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { ride: rideUuid } = await params;

  const ride = await db.query.rides.findFirst({
    where: and(eq(rides.rideUuid, rideUuid), eq(rides.userId, userId)),
  });
  if (!ride) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const [points, brakes, closeCalls] = await Promise.all([
    db
      .select({
        idx: ridePoints.idx,
        id: ridePoints.pointUuid,
        timestamp: ridePoints.timestamp,
        latitude: ridePoints.latitude,
        longitude: ridePoints.longitude,
        speed: ridePoints.speed,
        bumpiness: ridePoints.bumpiness,
        accelWindow: ridePoints.accelWindow,
        horizontalAccel: ridePoints.horizontalAccel,
      })
      .from(ridePoints)
      .where(eq(ridePoints.rideUuid, rideUuid))
      .orderBy(asc(ridePoints.idx)),
    db
      .select({
        id: brakeEvents.eventUuid,
        timestamp: brakeEvents.timestamp,
        latitude: brakeEvents.latitude,
        longitude: brakeEvents.longitude,
        peakDecelerationMPS2: brakeEvents.peakDecelerationMps2,
        durationSeconds: brakeEvents.durationSeconds,
      })
      .from(brakeEvents)
      .where(eq(brakeEvents.rideUuid, rideUuid))
      .orderBy(asc(brakeEvents.timestamp)),
    db
      .select({
        id: closeCallEvents.eventUuid,
        timestamp: closeCallEvents.timestamp,
        latitude: closeCallEvents.latitude,
        longitude: closeCallEvents.longitude,
      })
      .from(closeCallEvents)
      .where(eq(closeCallEvents.rideUuid, rideUuid))
      .orderBy(asc(closeCallEvents.timestamp)),
  ]);

  // Mirror the iOS sync schema. `brakeEvents` / `closeCallEvents` use
  // the three-state convention (null = "feature not run / available
  // when this ride was recorded"):
  //
  //   brakeEvents:   null when brakeEventsProcessed is false, else []
  //                  (or the populated list).
  //   closeCallEvents: null when closeCallsSupported is false, else
  //                    [] / populated.
  //
  // That keeps an export from a pre-v3 ride re-importable without
  // confusing it with a v3 ride that explicitly had no events.
  const payload = {
    schemaVersion: ride.schemaVersion,
    id: ride.rideUuid,
    title: ride.title,
    startedAt: ride.startedAt.toISOString(),
    endedAt: ride.endedAt.toISOString(),
    pocketMode: ride.pocketMode,
    points: points.map((p) => ({
      id: p.id,
      timestamp: p.timestamp.toISOString(),
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speed,
      bumpiness: p.bumpiness,
      accelWindow: p.accelWindow,
      ...(p.horizontalAccel !== null
        ? { horizontalAccel: p.horizontalAccel }
        : {}),
    })),
    brakeEvents: ride.brakeEventsProcessed
      ? brakes.map((b) => ({
          id: b.id,
          timestamp: b.timestamp.toISOString(),
          latitude: b.latitude,
          longitude: b.longitude,
          peakDecelerationMPS2: b.peakDecelerationMPS2,
          durationSeconds: b.durationSeconds,
        }))
      : null,
    closeCallEvents: ride.closeCallsSupported
      ? closeCalls.map((c) => ({
          id: c.id,
          timestamp: c.timestamp.toISOString(),
          latitude: c.latitude,
          longitude: c.longitude,
        }))
      : null,
    // Derived server-side fields, included so an export is a complete
    // record of how we computed each ride's stats. The sync route
    // recomputes these on POST, so they're not required for re-import.
    derived: {
      pointCount: ride.pointCount,
      distanceM: ride.distanceM,
      avgBumpiness: ride.avgBumpiness,
      maxBumpiness: ride.maxBumpiness,
      createdAt: ride.createdAt.toISOString(),
      updatedAt: ride.updatedAt.toISOString(),
    },
  };

  const filename = `ride-${slugify(ride.title)}-${ride.rideUuid.slice(0, 8)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
