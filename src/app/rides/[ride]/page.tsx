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
    <div className="mx-auto max-w-5xl">
      <RenameForm rideUuid={ride.rideUuid} initialTitle={ride.title} />

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
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
      </dl>

      <Section title="Route">
        {samples.length > 0 ? (
          <RouteMap samples={samples} />
        ) : (
          <EmptyBox>No points were recorded.</EmptyBox>
        )}
      </Section>

      <Section title="Bumpiness over time">
        {samples.length > 0 ? (
          <BumpinessChart samples={samples} />
        ) : (
          <EmptyBox>No samples to chart.</EmptyBox>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-text-muted">
      {children}
    </div>
  );
}
