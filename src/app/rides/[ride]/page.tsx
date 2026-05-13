import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { ridePoints, rides } from '@/db/schema';
import { formatDateTime, formatDistance, formatDuration } from '@/lib/formatters';
import { RouteMap } from './RouteMap';
import { BumpinessChart } from './BumpinessChart';
import { RenameForm } from './RenameForm';

export const dynamic = 'force-dynamic';

export default async function RideDetailPage({
  params,
}: {
  params: Promise<{ ride: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const { ride: rideUuid } = await params;

  const ride = await db.query.rides.findFirst({
    where: and(eq(rides.rideUuid, rideUuid), eq(rides.userId, session.user.id)),
  });
  if (!ride) notFound();

  const points = await db
    .select({
      latitude: ridePoints.latitude,
      longitude: ridePoints.longitude,
      bumpiness: ridePoints.bumpiness,
      timestamp: ridePoints.timestamp,
    })
    .from(ridePoints)
    .where(eq(ridePoints.rideUuid, rideUuid))
    .orderBy(asc(ridePoints.idx));

  const startMs = ride.startedAt.getTime();
  const samples = points.map((p) => ({
    lat: p.latitude,
    lon: p.longitude,
    bumpiness: p.bumpiness,
    tSec: (p.timestamp.getTime() - startMs) / 1000,
  }));

  return (
    <div style={{ maxWidth: 960 }}>
      <RenameForm rideUuid={ride.rideUuid} initialTitle={ride.title} />

      <div style={statsStyle}>
        <Stat label="Started" value={formatDateTime(ride.startedAt)} />
        <Stat
          label="Duration"
          value={formatDuration(
            (ride.endedAt.getTime() - ride.startedAt.getTime()) / 1000,
          )}
        />
        <Stat label="Distance" value={formatDistance(ride.distanceM)} />
        <Stat label="Points" value={ride.pointCount.toLocaleString()} />
        <Stat label="Avg bumpiness" value={`${ride.avgBumpiness.toFixed(2)} g`} />
        <Stat label="Max bumpiness" value={`${ride.maxBumpiness.toFixed(2)} g`} />
        <Stat
          label="Pocket mode"
          value={
            ride.pocketMode === true
              ? 'on'
              : ride.pocketMode === false
              ? 'off'
              : 'unknown'
          }
        />
      </div>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={sectionH2}>Route</h2>
        {samples.length > 0 ? (
          <RouteMap samples={samples} />
        ) : (
          <p style={{ color: '#9a9aac' }}>No points were recorded.</p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={sectionH2}>Bumpiness over time</h2>
        {samples.length > 0 ? (
          <BumpinessChart samples={samples} />
        ) : (
          <p style={{ color: '#9a9aac' }}>No samples to chart.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#9a9aac' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

const statsStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '1rem',
  padding: '1rem',
  background: '#101019',
  borderRadius: 6,
  border: '1px solid #22222c',
} as const;

const sectionH2 = {
  fontSize: 18,
  margin: '0 0 0.75rem 0',
  color: '#c4c4d4',
  fontWeight: 500,
} as const;
