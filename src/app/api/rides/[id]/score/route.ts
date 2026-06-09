import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { rides, scoreEvents } from '@/db/schema';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-ride score lookup. See bumpyride/docs/PER_RIDE_SCORE_WEB_HANDOFF.md.
//
// Shape mirrors /api/me/score's `breakdown` exactly so iOS can reuse
// its existing ScoreBreakdown type.
//
// `eligible: false` covers both pocket-mode rides and rides synced
// while the user had sharing off — in either case score_events has
// no rows for this ride. The endpoint always returns 200 in that
// case (so iOS can distinguish "didn't qualify" from "doesn't
// exist") and surfaces a zero breakdown.
//
// 404 only for rides that don't exist OR don't belong to the
// caller — keeps the endpoint non-enumerable.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { id: rideUuid } = await params;

  // Ownership check first so cross-user probes can't enumerate.
  const ride = await db.query.rides.findFirst({
    where: and(eq(rides.rideUuid, rideUuid), eq(rides.userId, userId)),
    columns: { rideUuid: true },
  });
  if (!ride) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Aggregate score_events for this ride. Each row was awarded at
  // sync time with a fixed tier; we just count + sum here.
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${scoreEvents.points}), 0)::int`,
      firstEver: sql<number>`COUNT(*) FILTER (WHERE ${scoreEvents.points} = 10)::int`,
      firstForYou: sql<number>`COUNT(*) FILTER (WHERE ${scoreEvents.points} = 5)::int`,
      staleRefresh: sql<number>`COUNT(*) FILTER (WHERE ${scoreEvents.points} = 3)::int`,
      repeat: sql<number>`COUNT(*) FILTER (WHERE ${scoreEvents.points} = 1)::int`,
    })
    .from(scoreEvents)
    .where(eq(scoreEvents.rideUuid, rideUuid));

  const totalPoints = Number(row?.total ?? 0);
  const firstEver = Number(row?.firstEver ?? 0);
  const firstForYou = Number(row?.firstForYou ?? 0);
  const staleRefresh = Number(row?.staleRefresh ?? 0);
  const repeat = Number(row?.repeat ?? 0);

  // A ride is "eligible" iff at least one score_event exists for it.
  // recomputeRideScore (src/lib/scoring.ts) only inserts when the
  // ride is mounted/legacy AND the user is sharing, and wipes the
  // rows on opt-out — so this implication holds both directions.
  const eligible = totalPoints > 0;

  return NextResponse.json(
    {
      rideId: rideUuid,
      totalPoints,
      breakdown: { firstEver, firstForYou, staleRefresh, repeat },
      eligible,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
