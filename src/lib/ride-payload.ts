import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { brakeEvents, closeCallEvents, ridePoints, rides } from '@/db/schema';

// Shared ride-payload builder. Used by /api/me/rides/[ride]/export
// (which adds a `derived` block with server-side stats) and by
// /api/sync/ride/[id] (which serves the iOS-schema JSON exactly as
// it round-trips through POST /api/sync/ride).
//
// Output mirrors bumpyride/docs/SCHEMA.md v3:
//   - points  -> always an array (may be empty)
//   - brakeEvents / closeCallEvents -> null when the corresponding
//     feature wasn't processed/supported, [] when processed-but-empty,
//     populated otherwise. Same three-state convention iOS uses
//     when uploading.

export type RideExportPayload = {
  schemaVersion: number;
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  pocketMode: boolean | null;
  points: Array<{
    id: string;
    timestamp: string;
    latitude: number;
    longitude: number;
    speed: number;
    bumpiness: number;
    accelWindow: number[];
    horizontalAccel?: number;
  }>;
  brakeEvents:
    | Array<{
        id: string;
        timestamp: string;
        latitude: number;
        longitude: number;
        peakDecelerationMPS2: number;
        durationSeconds: number;
      }>
    | null;
  closeCallEvents:
    | Array<{
        id: string;
        timestamp: string;
        latitude: number;
        longitude: number;
      }>
    | null;
};

export type RideExportDerived = {
  pointCount: number;
  distanceM: number;
  avgBumpiness: number;
  maxBumpiness: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Look up a single ride owned by `userId` and assemble its full
 * payload. Returns null if the ride doesn't exist or doesn't belong
 * to the caller (caller maps null → 404).
 */
export async function loadRideExport(
  rideUuid: string,
  userId: string,
): Promise<{
  payload: RideExportPayload;
  derived: RideExportDerived;
} | null> {
  const ride = await db.query.rides.findFirst({
    where: and(eq(rides.rideUuid, rideUuid), eq(rides.userId, userId)),
  });
  if (!ride) return null;

  const [points, brakes, closeCalls] = await Promise.all([
    db
      .select({
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

  const payload: RideExportPayload = {
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
      ...(p.horizontalAccel !== null ? { horizontalAccel: p.horizontalAccel } : {}),
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
  };

  const derived: RideExportDerived = {
    pointCount: ride.pointCount,
    distanceM: ride.distanceM,
    avgBumpiness: ride.avgBumpiness,
    maxBumpiness: ride.maxBumpiness,
    createdAt: ride.createdAt.toISOString(),
    updatedAt: ride.updatedAt.toISOString(),
  };

  return { payload, derived };
}

/**
 * Rough estimate of the ride's JSON-encoded size on the wire. Used
 * by /api/sync/rides to populate `sizeBytes` for the iOS pre-restore
 * "this will download ~N MB" warning. Computed from cached
 * point_count rather than materialising the JSON — it's an estimate,
 * not a contract.
 */
export function estimateRideSizeBytes(args: {
  pointCount: number;
}): number {
  // Per-point JSON is roughly:
  //   id (uuid)               ~40
  //   timestamp (iso)         ~30
  //   latitude/longitude      ~30
  //   speed/bumpiness         ~20
  //   horizontalAccel (opt)   ~20
  //   accelWindow (250 nums)  ~1500-2000
  //   keys + braces + commas  ~80
  // Conservative ~280 bytes per point not counting accelWindow,
  // plus accelWindow contents. accelWindow holds 250 samples × ~6
  // chars per number = ~1500 chars per point. Combined ~1800 bytes.
  // Plus per-ride header (title, ids, brake/closecall arrays):
  // ~500 bytes baseline.
  return 500 + args.pointCount * 1800;
}
