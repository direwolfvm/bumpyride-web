import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { rides, userScores, users } from '@/db/schema';
import { formatDistance, formatDuration } from '@/lib/formatters';
import { LEVELS, levelFor } from '@/lib/levels';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Score',
};

export default async function ScorePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=%2Fscore');
  const userId = session.user.id;

  const [user, score, ridesAgg] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { shareToPublicMap: true },
    }),
    db.query.userScores.findFirst({
      where: eq(userScores.userId, userId),
    }),
    // Lifetime totals across every ride — mode-agnostic so it
    // counts even pocket-mode rides that don't earn points. Riders
    // care about "how much have I ridden total."
    db
      .select({
        rideCount: sql<number>`COUNT(*)::int`,
        totalDistanceM: sql<number>`COALESCE(SUM(${rides.distanceM}), 0)::float8`,
        totalDurationSec: sql<number>`
          COALESCE(
            SUM(EXTRACT(EPOCH FROM (${rides.endedAt} - ${rides.startedAt}))),
            0
          )::float8`,
      })
      .from(rides)
      .where(eq(rides.userId, userId)),
  ]);

  if (!user) redirect('/login');

  const totalPoints = Number(score?.totalPoints ?? 0);
  const firstEver = score?.firstEverCount ?? 0;
  const firstForYou = score?.firstUserCount ?? 0;
  const staleRefresh = score?.staleRefreshCount ?? 0;
  const repeat = score?.repeatCount ?? 0;
  const { level, nextThreshold, progress } = levelFor(totalPoints);

  const rideCount = Number(ridesAgg[0]?.rideCount ?? 0);
  const totalDistanceM = Number(ridesAgg[0]?.totalDistanceM ?? 0);
  const totalDurationSec = Number(ridesAgg[0]?.totalDurationSec ?? 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Score
      </h1>
      <p className="mt-2 text-text-muted">
        Each 20 ft cell on the public bump map is worth points. Cover new
        ground, return often. Only mounted-mode rides with public sharing
        on count.
      </p>

      {/* Lifetime totals — every ride counts here, even pocket-mode
          rides that don't earn points. Gives the user a sense of how
          much they've actually ridden, separate from their score. */}
      <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
        <TotalStat label="Rides" value={rideCount.toLocaleString()} />
        <TotalStat label="Distance" value={rideCount > 0 ? formatDistance(totalDistanceM) : '—'} />
        <TotalStat label="Time" value={rideCount > 0 ? formatDuration(totalDurationSec) : '—'} />
      </dl>

      {!user.shareToPublicMap ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-surface p-6">
          <p className="text-text-muted">
            Public sharing is off, so you&apos;re not earning points yet.
            Turn it on at{' '}
            <Link
              href="/settings/privacy"
              className="text-accent hover:underline"
            >
              /settings/privacy
            </Link>{' '}
            to start. Every cell your existing rides touch will be scored
            against the current map as soon as you opt in.
          </p>
        </div>
      ) : (
        <>
          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <div className="text-xs uppercase tracking-wide text-text-muted">
              Level {level.index} of {LEVELS.length}
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">
                {level.name}
              </h2>
              <span className="text-sm tabular-nums text-text-muted">
                {totalPoints.toLocaleString()} pts
              </span>
            </div>
            {nextThreshold !== null ? (
              <>
                <div
                  className="mt-4 h-2 w-full overflow-hidden rounded-full bg-border"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <div
                    className="h-full rounded-full bg-accent-strong"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-text-muted">
                  {(nextThreshold - totalPoints).toLocaleString()} pts to
                  the next level ({LEVELS[level.index]?.name}).
                </div>
              </>
            ) : (
              <div className="mt-4 text-sm text-accent">
                You&apos;ve reached the top of the ladder. We&apos;ll add
                higher tiers as people break through.
              </div>
            )}
          </section>

          <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Breakdown
              label="First ever"
              caption="No one had recorded data in these cells before you."
              count={firstEver}
              points={firstEver * 10}
              perCell="10 pts"
            />
            <Breakdown
              label="First time for you"
              caption="Other riders had the cell already; you joined."
              count={firstForYou}
              points={firstForYou * 5}
              perCell="5 pts"
            />
            <Breakdown
              label="Stale-refresh"
              caption="You returned to a cell more than 10 days after your last measurement there."
              count={staleRefresh}
              points={staleRefresh * 3}
              perCell="3 pts"
            />
            <Breakdown
              label="Return visits"
              caption="Rides through cells you'd already mapped recently."
              count={repeat}
              points={repeat * 1}
              perCell="1 pt"
            />
          </section>
        </>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
          How it works
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-text-muted">
          <li>
            <strong className="text-text">10 points</strong> — First user
            to ever record bump data in a 20 ft cell. The original
            discoverer gets the prize.
          </li>
          <li>
            <strong className="text-text">5 points</strong> — First time
            you&apos;ve recorded in a cell that other riders already had.
          </li>
          <li>
            <strong className="text-text">3 points</strong> — A return
            visit to one of your cells more than 10 days after your last
            ride through it. Rewards keeping your coverage fresh.
          </li>
          <li>
            <strong className="text-text">1 point</strong> — A repeat
            visit within the last 10 days.
          </li>
          <li>
            Only your <strong>mounted-mode</strong> rides count, matching
            the public-map eligibility rule. Pocket-mode rides stay on
            your personal map but don&apos;t earn points.
          </li>
          <li>
            Turning public sharing off resets your score to zero. Turning
            it back on backfills from every eligible ride you&apos;ve ever
            synced.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
          Level ladder
        </h2>
        <ol className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
          {LEVELS.map((l) => {
            const isCurrent = l.index === level.index;
            return (
              <li
                key={l.index}
                className={`flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0 ${
                  isCurrent ? 'bg-accent-soft/40' : ''
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <span className="w-6 font-mono text-xs tabular-nums text-text-muted">
                    {l.index}
                  </span>
                  <span className={isCurrent ? 'font-medium' : ''}>
                    {l.name}
                  </span>
                  {isCurrent && (
                    <span className="text-xs uppercase tracking-wide text-accent">
                      You are here
                    </span>
                  )}
                </div>
                <span className="font-mono text-sm tabular-nums text-text-muted">
                  {l.threshold.toLocaleString()} pts
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function TotalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Breakdown({
  label,
  caption,
  count,
  points,
  perCell,
}: {
  label: string;
  caption: string;
  count: number;
  points: number;
  perCell: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <span className="text-xs text-text-dim">{perCell}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {count.toLocaleString()}
      </div>
      <div className="mt-0.5 text-sm tabular-nums text-text-muted">
        {points.toLocaleString()} pts
      </div>
      <p className="mt-2 text-xs text-text-muted">{caption}</p>
    </div>
  );
}
