import { notFound, redirect } from 'next/navigation';
import { and, asc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { auth } from '@/auth';
import { db } from '@/db';
import { brakeEvents, closeCallEvents, ridePoints, rides, scoreEvents } from '@/db/schema';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatSpeed,
} from '@/lib/formatters';
import { BrakeEventsSection } from './BrakeEventsSection';
import { CloseCallsSection } from './CloseCallsSection';
import { RouteMap } from './RouteMap';
import { BumpinessChart } from './BumpinessChart';
import { RenameForm } from './RenameForm';

const G_MPS2 = 9.80665;

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

  const [points, brakeRows, closeCallRows, scoreAgg] = await Promise.all([
    db
      .select({
        latitude: ridePoints.latitude,
        longitude: ridePoints.longitude,
        bumpiness: ridePoints.bumpiness,
        speed: ridePoints.speed,
        timestamp: ridePoints.timestamp,
      })
      .from(ridePoints)
      .where(eq(ridePoints.rideUuid, rideUuid))
      .orderBy(asc(ridePoints.idx)),
    db
      .select({
        eventUuid: brakeEvents.eventUuid,
        timestamp: brakeEvents.timestamp,
        latitude: brakeEvents.latitude,
        longitude: brakeEvents.longitude,
        peakDecelerationMps2: brakeEvents.peakDecelerationMps2,
        durationSeconds: brakeEvents.durationSeconds,
      })
      .from(brakeEvents)
      .where(eq(brakeEvents.rideUuid, rideUuid))
      .orderBy(asc(brakeEvents.timestamp)),
    db
      .select({
        eventUuid: closeCallEvents.eventUuid,
        timestamp: closeCallEvents.timestamp,
        latitude: closeCallEvents.latitude,
        longitude: closeCallEvents.longitude,
      })
      .from(closeCallEvents)
      .where(eq(closeCallEvents.rideUuid, rideUuid))
      .orderBy(asc(closeCallEvents.timestamp)),
    db
      .select({
        total: sql<number>`COALESCE(SUM(${scoreEvents.points}), 0)::int`,
        firstEver: sql<number>`COUNT(*) FILTER (WHERE ${scoreEvents.points} = 10)::int`,
        firstForYou: sql<number>`COUNT(*) FILTER (WHERE ${scoreEvents.points} = 5)::int`,
        repeat: sql<number>`COUNT(*) FILTER (WHERE ${scoreEvents.points} = 1)::int`,
      })
      .from(scoreEvents)
      .where(eq(scoreEvents.rideUuid, rideUuid)),
  ]);
  const ridePointsEarned = Number(scoreAgg[0]?.total ?? 0);
  const rideScoreBreakdown = {
    firstEver: Number(scoreAgg[0]?.firstEver ?? 0),
    firstForYou: Number(scoreAgg[0]?.firstForYou ?? 0),
    repeat: Number(scoreAgg[0]?.repeat ?? 0),
  };

  const startMs = ride.startedAt.getTime();
  const samples = points.map((p) => ({
    lat: p.latitude,
    lon: p.longitude,
    bumpiness: p.bumpiness,
    tSec: (p.timestamp.getTime() - startMs) / 1000,
  }));
  const brakes = brakeRows.map((b) => ({
    id: b.eventUuid,
    tSec: (b.timestamp.getTime() - startMs) / 1000,
    lat: b.latitude,
    lon: b.longitude,
    peakMps2: b.peakDecelerationMps2,
    peakG: b.peakDecelerationMps2 / G_MPS2,
    durationSeconds: b.durationSeconds,
  }));
  const closeCalls = closeCallRows.map((c) => ({
    id: c.eventUuid,
    tSec: (c.timestamp.getTime() - startMs) / 1000,
    lat: c.latitude,
    lon: c.longitude,
  }));

  // Derived stats for the header grid. Avg speed is wall-clock
  // (distance / duration) — same as Strava et al. and includes time
  // stopped at lights. Max speed is the largest single-point speed
  // sample, which matches the iOS "Max speed" stat on the saved-ride
  // view exactly. Durations < 1s clamp to avoid divide-by-zero on
  // pathologically short rides.
  const durationSec = Math.max(
    1,
    (ride.endedAt.getTime() - ride.startedAt.getTime()) / 1000,
  );
  const avgSpeedMps = ride.distanceM / durationSec;
  const maxSpeedMps = points.reduce(
    (best, p) => (p.speed > best ? p.speed : best),
    0,
  );

  // Three-state display for incident counts:
  //   brakeEventsProcessed=false → "—" (detector hasn't run yet)
  //   closeCallsSupported=false  → "—" (ride predates the feature)
  // The dedicated sections below still spell out the full explanation;
  // the stat cell just shows a count or em-dash.
  const brakeStat = ride.brakeEventsProcessed
    ? brakes.length.toLocaleString()
    : '—';
  const closeCallStat = ride.closeCallsSupported
    ? closeCalls.length.toLocaleString()
    : '—';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <RenameForm rideUuid={ride.rideUuid} initialTitle={ride.title} />
        <a
          href={`/api/me/rides/${ride.rideUuid}/export`}
          className="rounded border border-border-strong px-3 py-1.5 text-sm text-text-muted hover:border-accent hover:text-text"
          download
        >
          Export ride (JSON)
        </a>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Started" value={formatDateTime(ride.startedAt)} />
        <Stat label="Duration" value={formatDuration(durationSec)} />
        <Stat label="Distance" value={formatDistance(ride.distanceM)} />
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
        <Stat label="Avg speed" value={formatSpeed(avgSpeedMps)} />
        <Stat label="Max speed" value={formatSpeed(maxSpeedMps)} />
        <Stat label="Avg bumpiness" value={`${ride.avgBumpiness.toFixed(2)} g`} />
        <Stat label="Max bumpiness" value={`${ride.maxBumpiness.toFixed(2)} g`} />
        <Stat
          label="Hard brakes"
          value={brakeStat}
          hint={!ride.brakeEventsProcessed ? 'detection pending' : undefined}
        />
        <Stat
          label="Close calls"
          value={closeCallStat}
          hint={!ride.closeCallsSupported ? 'predates feature' : undefined}
        />
        <Stat
          label="Points earned"
          value={ridePointsEarned > 0 ? `+${ridePointsEarned.toLocaleString()}` : '—'}
          hint={ridePointsEarned === 0 ? 'sharing off' : 'cell discovery'}
          details={
            ridePointsEarned > 0 ? (
              <ScoreBreakdown breakdown={rideScoreBreakdown} />
            ) : undefined
          }
        />
        <Stat label="Samples" value={ride.pointCount.toLocaleString()} />
      </dl>
      <p className="mt-2 text-xs text-text-muted">
        See your total + level on{' '}
        <Link href="/score" className="text-accent hover:underline">
          /score
        </Link>
        .
      </p>

      <Section title="Route">
        {samples.length > 0 ? (
          <RouteMap
            samples={samples}
            brakeMarkers={brakes.map((b) => ({
              lat: b.lat,
              lon: b.lon,
              peakMps2: b.peakMps2,
            }))}
            closeCallMarkers={closeCalls.map((c) => ({
              lat: c.lat,
              lon: c.lon,
            }))}
          />
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

      <Section title="Hard brakes">
        <BrakeEventsSection
          processed={ride.brakeEventsProcessed}
          events={brakes}
        />
      </Section>

      <Section title="Close calls">
        <CloseCallsSection
          supported={ride.closeCallsSupported}
          events={closeCalls}
        />
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  details,
}: {
  label: string;
  value: string;
  hint?: string;
  details?: React.ReactNode;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-medium tabular-nums">{value}</dd>
      {hint && <div className="mt-0.5 text-xs text-text-dim">{hint}</div>}
      {details}
    </div>
  );
}

// Per-ride score breakdown surfaced via a native <details> disclosure
// under the "Points earned" Stat. No client JS — the browser owns
// the toggle. Closed by default to keep the stat grid compact;
// clicking the ⓘ summary expands to show how the ride's points split
// across the three tiers.
function ScoreBreakdown({
  breakdown,
}: {
  breakdown: { firstEver: number; firstForYou: number; repeat: number };
}) {
  const items = [
    {
      label: 'New cells',
      hint: 'first rider ever to reach these',
      count: breakdown.firstEver,
      per: 10,
    },
    {
      label: 'New to me',
      hint: 'someone else had them, you joined',
      count: breakdown.firstForYou,
      per: 5,
    },
    {
      label: 'Old cells',
      hint: 'cells you had mapped before',
      count: breakdown.repeat,
      per: 1,
    },
  ];
  return (
    <details className="group mt-2 text-xs">
      <summary
        className="inline-flex cursor-pointer items-center gap-1 text-text-muted hover:text-text"
        aria-label="Show score breakdown"
      >
        <span
          aria-hidden
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-text-muted text-[10px] leading-none"
        >
          i
        </span>
        <span className="group-open:hidden">breakdown</span>
        <span className="hidden group-open:inline">hide</span>
      </summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((it) => (
          <li
            key={it.label}
            className="flex items-baseline justify-between gap-3 tabular-nums"
          >
            <div className="flex flex-col">
              <span className="text-text">{it.label}</span>
              <span className="text-[10px] text-text-dim">{it.hint}</span>
            </div>
            <div className="text-right">
              <div>
                <span className="font-medium text-text">
                  {it.count.toLocaleString()}
                </span>{' '}
                <span className="text-text-muted">×{it.per}</span>
              </div>
              <div className="text-text-muted">
                = {(it.count * it.per).toLocaleString()} pts
              </div>
            </div>
          </li>
        ))}
      </ul>
    </details>
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
