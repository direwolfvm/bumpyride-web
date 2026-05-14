import Link from 'next/link';
import { redirect } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { rides } from '@/db/schema';
import { formatDateTime, formatDistance, formatDuration } from '@/lib/formatters';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function RidesListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const userId = session.user.id;
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        rideUuid: rides.rideUuid,
        title: rides.title,
        startedAt: rides.startedAt,
        endedAt: rides.endedAt,
        pointCount: rides.pointCount,
        distanceM: rides.distanceM,
        maxBumpiness: rides.maxBumpiness,
        avgBumpiness: rides.avgBumpiness,
        pocketMode: rides.pocketMode,
      })
      .from(rides)
      .where(eq(rides.userId, userId))
      .orderBy(desc(rides.startedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ n: count() }).from(rides).where(eq(rides.userId, userId)),
  ]);

  const total = totalRows[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your rides
        </h1>
        <span className="text-sm text-text-muted">
          {total === 0 ? '' : `${total} ride${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Distance</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Avg bumpiness</th>
                <th className="px-4 py-3 font-medium">Max bumpiness</th>
                <th
                  className="px-4 py-3 font-medium"
                  title="Whether the iOS app's 3 Hz body-bob filter was active during recording. Pocket-mode rides are damped and don't contribute to the public map."
                >
                  Pocket mode
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.rideUuid}
                  className="border-t border-border first:border-t-0 hover:bg-surface-2/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/rides/${r.rideUuid}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                    {formatDateTime(r.startedAt)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    {formatDistance(r.distanceM)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    {formatDuration(
                      (r.endedAt.getTime() - r.startedAt.getTime()) / 1000,
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.avgBumpiness.toFixed(2)} g
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.maxBumpiness.toFixed(2)} g
                  </td>
                  <td className="px-4 py-3">
                    <PocketBadge value={r.pocketMode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center gap-4 text-sm">
          {page > 1 ? (
            <Link
              href={`/rides?page=${page - 1}`}
              className="text-accent hover:underline"
            >
              ← Prev
            </Link>
          ) : (
            <span className="text-text-dim">← Prev</span>
          )}
          <span className="text-text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/rides?page=${page + 1}`}
              className="text-accent hover:underline"
            >
              Next →
            </Link>
          ) : (
            <span className="text-text-dim">Next →</span>
          )}
        </nav>
      )}
    </div>
  );
}

function PocketBadge({ value }: { value: boolean | null }) {
  // Each badge style hints what it means for the public aggregate:
  //   off → contributes (calibrated, mounted sensor) → accent
  //   on  → personal-only (damped) → muted
  //   unknown → personal-only (legacy ride, sensing mode wasn't captured)
  if (value === null) {
    return <span className="text-text-dim">—</span>;
  }
  if (value === true) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-muted">
        On
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
      Off
    </span>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <p className="text-text-muted">
        No rides synced yet. Pair the iOS app from{' '}
        <Link href="/settings/tokens" className="text-accent hover:underline">
          /settings/tokens
        </Link>{' '}
        and rides will appear here as they upload.
      </p>
    </div>
  );
}
