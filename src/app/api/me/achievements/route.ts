import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { achievementEvents } from '@/db/schema';
import {
  MILESTONE_ACHIEVEMENTS,
  PER_RIDE_ACHIEVEMENTS,
} from '@/lib/achievements';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Full achievements listing for the authenticated user. Session OR
// bearer auth so iOS can render its achievements screen from the
// same endpoint. Two blocks:
//
//   registry — every defined achievement (so the client can show
//     locked/unearned entries) with the caller's earned counts and
//     points rolled up per achievement.
//   recent   — the newest award rows (ride-time ordered), for a
//     "recent unlocks" feed. Capped at 50.

const RECENT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const rows = await db
    .select({
      achievementId: achievementEvents.achievementId,
      points: achievementEvents.points,
      threshold: achievementEvents.threshold,
      rideUuid: achievementEvents.rideUuid,
      createdAt: achievementEvents.createdAt,
    })
    .from(achievementEvents)
    .where(eq(achievementEvents.userId, userId))
    .orderBy(desc(achievementEvents.createdAt));

  const byId = new Map<string, { count: number; points: number }>();
  for (const r of rows) {
    const cur = byId.get(r.achievementId) ?? { count: 0, points: 0 };
    cur.count += 1;
    cur.points += r.points;
    byId.set(r.achievementId, cur);
  }

  const registry = [
    ...PER_RIDE_ACHIEVEMENTS.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      description: a.description,
      kind: 'per-ride' as const,
      tiers: a.tiers,
      earnedCount: byId.get(a.id)?.count ?? 0,
      earnedPoints: byId.get(a.id)?.points ?? 0,
    })),
    ...MILESTONE_ACHIEVEMENTS.map((a) => ({
      id: a.id,
      name: a.name,
      category: 'milestone' as const,
      description: a.description,
      kind: 'milestone' as const,
      tiers: a.tiers,
      earnedCount: byId.get(a.id)?.count ?? 0,
      earnedPoints: byId.get(a.id)?.points ?? 0,
    })),
  ];

  return NextResponse.json({
    totalPoints: rows.reduce((s, r) => s + r.points, 0),
    totalAwards: rows.length,
    registry,
    recent: rows.slice(0, RECENT_LIMIT).map((r) => ({
      achievementId: r.achievementId,
      points: r.points,
      threshold: r.threshold,
      rideId: r.rideUuid,
      earnedAt: r.createdAt.toISOString(),
    })),
  });
}
