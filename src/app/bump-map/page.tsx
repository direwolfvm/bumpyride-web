import { redirect } from 'next/navigation';
import Link from 'next/link';
import { count, eq, max, min } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { ridePoints, rides } from '@/db/schema';
import { PrivateBumpMap } from './PrivateBumpMap';

export const dynamic = 'force-dynamic';

export default async function BumpMapPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

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
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Your bump map
      </h1>
      <p className="mt-2 max-w-3xl text-text-muted">
        Average bumpiness aggregated across every ride you&apos;ve synced.
        Cells are 20 ft on a side, anchored to the same grid the iOS app uses,
        so cells match across web and device exactly.
      </p>
      <div className="mt-6">
        {hasData ? (
          <PrivateBumpMap
            minLat={row.minLat!}
            maxLat={row.maxLat!}
            minLon={row.minLon!}
            maxLon={row.maxLon!}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-text-muted">
            <p>
              No rides synced yet. Pair the iOS app from{' '}
              <Link
                href="/settings/tokens"
                className="text-accent hover:underline"
              >
                /settings/tokens
              </Link>{' '}
              to start building your map.
            </p>
            <p className="mt-2 text-sm">
              Don&apos;t have the app yet?{' '}
              <a
                href="https://apps.apple.com/app/id6769580787"
                className="text-accent hover:underline"
              >
                Download BumpyRide on the App Store
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
