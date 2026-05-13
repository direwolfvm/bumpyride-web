import { redirect } from 'next/navigation';
import { count, eq, max, min } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { ridePoints, rides } from '@/db/schema';
import { PrivateBumpMap } from './PrivateBumpMap';

export const dynamic = 'force-dynamic';

export default async function BumpMapPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Bounding box of the user's data, so the map opens centered + zoomed
  // appropriately even if they haven't ridden in DC.
  const bbox = await db
    .select({
      minLat: min(ridePoints.latitude),
      maxLat: max(ridePoints.latitude),
      minLon: min(ridePoints.longitude),
      maxLon: max(ridePoints.longitude),
      points: count(),
    })
    .from(ridePoints)
    .innerJoin(rides, eq(rides.rideUuid, ridePoints.rideUuid))
    .where(eq(rides.userId, session.user.id));

  const row = bbox[0];
  const hasData =
    row !== undefined &&
    row.minLat !== null &&
    row.maxLat !== null &&
    row.minLon !== null &&
    row.maxLon !== null;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Your bump map</h1>
      <p style={{ color: '#9a9aac' }}>
        Average bumpiness aggregated across every ride you&apos;ve synced.
        Cells are 20 ft on a side, anchored to the same grid the iOS app
        uses, so cells match across web and device exactly.
      </p>
      {hasData ? (
        <PrivateBumpMap
          minLat={row.minLat!}
          maxLat={row.maxLat!}
          minLon={row.minLon!}
          maxLon={row.maxLon!}
        />
      ) : (
        <p style={{ color: '#9a9aac' }}>
          No rides synced yet — pair the iOS app to start building your map.
        </p>
      )}
    </div>
  );
}
