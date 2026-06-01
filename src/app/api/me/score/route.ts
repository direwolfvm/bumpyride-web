import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { userScores, users } from '@/db/schema';
import { LEVELS, levelFor } from '@/lib/levels';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cell-discovery score for the authenticated user. Session OR bearer
// auth so the iOS app can pull the same numbers it shows on its own
// gamification surface using the existing sync token.
//
// Response shape is deliberately small so iOS can poll it cheaply:
//
//   {
//     "totalPoints":     2147,
//     "breakdown": {
//       "firstEver":     12,   // count of 10-pt cells
//       "firstForYou":   84,   // count of 5-pt cells
//       "repeat":        465   // count of 1-pt (ride, cell) rows
//     },
//     "level": {
//       "index":         11,   // 1..20
//       "name":          "Drain Detective",
//       "threshold":     2000,
//       "nextThreshold": 2750,
//       "progress":      0.196 // 0..1 toward the next level
//     },
//     "levels":          [ { index, name, threshold }, ... ],
//     "eligible":        true  // share_to_public_map is on
//   }

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Eligibility check — when sharing is off, the score is zero by
  // construction (scoring.ts wipes the rows on opt-out). We still
  // return the level/threshold metadata so the iOS app can render
  // the empty-state UI with the correct ladder.
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { shareToPublicMap: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const score = await db.query.userScores.findFirst({
    where: eq(userScores.userId, userId),
  });

  const totalPoints = Number(score?.totalPoints ?? 0);
  const breakdown = {
    firstEver: score?.firstEverCount ?? 0,
    firstForYou: score?.firstUserCount ?? 0,
    repeat: score?.repeatCount ?? 0,
  };
  const { level, nextThreshold, progress } = levelFor(totalPoints);

  return NextResponse.json({
    totalPoints,
    breakdown,
    level: {
      index: level.index,
      name: level.name,
      threshold: level.threshold,
      nextThreshold,
      progress,
    },
    levels: LEVELS.map((l) => ({
      index: l.index,
      name: l.name,
      threshold: l.threshold,
    })),
    eligible: user.shareToPublicMap,
  });
}
