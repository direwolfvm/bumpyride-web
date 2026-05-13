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
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ marginTop: 0 }}>Your rides</h1>
      <p style={{ color: '#9a9aac' }}>
        {total === 0
          ? 'No rides synced yet. Pair the iOS app to start syncing.'
          : `${total} ride${total === 1 ? '' : 's'}.`}
      </p>

      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#9a9aac' }}>
              <th style={th}>Title</th>
              <th style={th}>Started</th>
              <th style={th}>Distance</th>
              <th style={th}>Duration</th>
              <th style={th}>Avg bumpiness</th>
              <th style={th}>Max bumpiness</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rideUuid} style={{ borderTop: '1px solid #22222c' }}>
                <td style={td}>
                  <Link
                    href={`/rides/${r.rideUuid}`}
                    style={{ color: '#9bb4ff', textDecoration: 'none' }}
                  >
                    {r.title}
                  </Link>
                </td>
                <td style={td}>{formatDateTime(r.startedAt)}</td>
                <td style={td}>{formatDistance(r.distanceM)}</td>
                <td style={td}>
                  {formatDuration(
                    (r.endedAt.getTime() - r.startedAt.getTime()) / 1000,
                  )}
                </td>
                <td style={td}>{r.avgBumpiness.toFixed(2)} g</td>
                <td style={td}>{r.maxBumpiness.toFixed(2)} g</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <nav style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          {page > 1 && (
            <Link href={`/rides?page=${page - 1}`} style={pageLink}>
              ← Prev
            </Link>
          )}
          <span style={{ color: '#9a9aac', fontSize: 14 }}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/rides?page=${page + 1}`} style={pageLink}>
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

const th = { padding: '0.5rem 0.75rem', fontWeight: 500 } as const;
const td = { padding: '0.5rem 0.75rem' } as const;
const pageLink = {
  color: '#9bb4ff',
  textDecoration: 'none',
  fontSize: 14,
} as const;
