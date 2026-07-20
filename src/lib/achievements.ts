import type { PoolClient } from 'pg';

// Achievement registry + award engine. Tiers are fixed at 100 / 200 /
// 400 points. Calibrated against a real 150-ride / 90-day / 833-mile
// corpus (~600k discovery points) so that achievements contribute
// roughly 10% of a normal rider's combined total (measured 9.2% on
// the calibration corpus). See docs/ACHIEVEMENTS_IOS_HANDOFF.md in
// the bumpy-ride repo for the full contract.
//
// Two shapes:
//   - Per-ride achievements: repeatable; each qualifying ride earns
//     the HIGHEST tier it meets per achievement. Recomputed with the
//     ride on re-upload (wipe + re-award, deterministic from the
//     ride's own stats — like score_events).
//   - Milestone ladders: one-time per rung, monotonic — never
//     revoked even if later edits drop the cumulative below the
//     rung. Evaluated after every sync.
//
// Eligibility matches cell-discovery scoring exactly: sharing ON and
// mounted-or-legacy rides only. Opting out wipes achievements with
// the score; opting back in backfills both.

export type AchievementPoints = 100 | 200 | 400;

export type Tier = { threshold: number; points: AchievementPoints };

export type PerRideAchievement = {
  id: string;
  name: string;
  category: 'ride' | 'exploration' | 'surface' | 'safety';
  description: string;
  // Metric key into RideAchievementStats.
  metric: keyof RideAchievementStats;
  // 'gte' = higher is better (thresholds ascending); 'lte' = lower is
  // better (thresholds descending, e.g. smoothness).
  direction: 'gte' | 'lte';
  tiers: readonly Tier[];
  // Optional qualifiers, applied before tier evaluation.
  minDistanceMi?: number;
  maxDurationMin?: number;
};

export type MilestoneAchievement = {
  id: string;
  name: string;
  description: string;
  metric: 'totalMiles' | 'totalRides' | 'totalCells' | 'totalHours';
  tiers: readonly Tier[];
};

export type RideAchievementStats = {
  distanceMi: number;
  durationMin: number;
  newCells: number;      // score_events tiers 10 + 5 for the ride
  ridePoints: number;    // SUM(score_events.points) for the ride
  revisits: number;      // score_events tiers 1 + 3 for the ride
  highBumpSamples: number; // ride points with bumpiness >= 1.5 g
  maxBump: number;       // g
  avgBump: number;       // g
  closeCalls: number;
  blockedLanes: number;  // public-eligible blocked-lane other events
};

// Threshold for a "high bump" sample, in g. Shared with the backfill
// SQL in migration 0020.
export const HIGH_BUMP_G = 1.5;

export const PER_RIDE_ACHIEVEMENTS: readonly PerRideAchievement[] = [
  {
    id: 'long-haul',
    name: 'Long Haul',
    category: 'ride',
    description: 'Cover serious distance in a single ride.',
    metric: 'distanceMi',
    direction: 'gte',
    tiers: [
      { threshold: 5, points: 100 },
      { threshold: 10, points: 200 },
      { threshold: 15, points: 400 },
    ],
  },
  {
    id: 'endurance',
    name: 'Endurance',
    category: 'ride',
    description: 'Stay in the saddle.',
    metric: 'durationMin',
    direction: 'gte',
    // Rides over 10 h are almost certainly forgotten recordings, not
    // epics — excluded so a left-running app can't farm the 400 tier.
    maxDurationMin: 600,
    tiers: [
      { threshold: 30, points: 100 },
      { threshold: 45, points: 200 },
      { threshold: 90, points: 400 },
    ],
  },
  {
    id: 'trailblazer',
    name: 'Trailblazer',
    category: 'exploration',
    description: 'Map cells you have never ridden before.',
    metric: 'newCells',
    direction: 'gte',
    tiers: [
      { threshold: 250, points: 100 },
      { threshold: 750, points: 200 },
      { threshold: 1500, points: 400 },
    ],
  },
  {
    id: 'big-haul',
    name: 'Big Haul',
    category: 'exploration',
    description: 'Bank a mountain of discovery points in one ride.',
    metric: 'ridePoints',
    direction: 'gte',
    tiers: [
      { threshold: 4000, points: 100 },
      { threshold: 8000, points: 200 },
      { threshold: 15000, points: 400 },
    ],
  },
  {
    id: 'groundskeeper',
    name: 'Groundskeeper',
    category: 'exploration',
    description: 'Re-measure ground you have already mapped.',
    metric: 'revisits',
    direction: 'gte',
    tiers: [
      { threshold: 750, points: 100 },
      { threshold: 1250, points: 200 },
      { threshold: 1750, points: 400 },
    ],
  },
  {
    id: 'rough-rider',
    name: 'Rough Rider',
    category: 'surface',
    description: 'Log a ride full of hard hits (samples ≥ 1.5 g).',
    metric: 'highBumpSamples',
    direction: 'gte',
    tiers: [
      { threshold: 3, points: 100 },
      { threshold: 8, points: 200 },
      { threshold: 15, points: 400 },
    ],
  },
  {
    id: 'big-hit',
    name: 'Big Hit',
    category: 'surface',
    description: 'Record a single monster bump.',
    metric: 'maxBump',
    direction: 'gte',
    tiers: [
      { threshold: 1.8, points: 100 },
      { threshold: 2.3, points: 200 },
      { threshold: 2.8, points: 400 },
    ],
  },
  {
    id: 'silk-road',
    name: 'Silk Road',
    category: 'surface',
    description: 'Find genuinely smooth pavement (2+ mile rides).',
    metric: 'avgBump',
    direction: 'lte',
    minDistanceMi: 2,
    tiers: [
      { threshold: 0.25, points: 100 },
      { threshold: 0.2, points: 200 },
      { threshold: 0.15, points: 400 },
    ],
  },
  {
    id: 'survivor',
    name: 'Survivor',
    category: 'safety',
    description: 'Ride through close calls and log them.',
    metric: 'closeCalls',
    direction: 'gte',
    tiers: [
      { threshold: 1, points: 100 },
      { threshold: 2, points: 200 },
      { threshold: 4, points: 400 },
    ],
  },
  {
    id: 'lane-scout',
    name: 'Lane Scout',
    category: 'safety',
    description: 'Report blocked lanes for other riders.',
    metric: 'blockedLanes',
    direction: 'gte',
    tiers: [
      { threshold: 1, points: 100 },
      { threshold: 3, points: 200 },
      { threshold: 5, points: 400 },
    ],
  },
];

export const MILESTONE_ACHIEVEMENTS: readonly MilestoneAchievement[] = [
  {
    id: 'odometer',
    name: 'Odometer',
    description: 'Lifetime miles across eligible rides.',
    metric: 'totalMiles',
    tiers: [
      { threshold: 25, points: 100 },
      { threshold: 50, points: 100 },
      { threshold: 100, points: 200 },
      { threshold: 200, points: 200 },
      { threshold: 400, points: 400 },
      { threshold: 800, points: 400 },
      { threshold: 1600, points: 400 },
      { threshold: 3200, points: 400 },
    ],
  },
  {
    id: 'ride-tally',
    name: 'Ride Tally',
    description: 'Lifetime count of eligible rides.',
    metric: 'totalRides',
    tiers: [
      { threshold: 10, points: 100 },
      { threshold: 25, points: 100 },
      { threshold: 50, points: 200 },
      { threshold: 100, points: 200 },
      { threshold: 250, points: 400 },
      { threshold: 500, points: 400 },
      { threshold: 1000, points: 400 },
    ],
  },
  {
    id: 'atlas',
    name: 'Atlas',
    description: 'Distinct 20 ft cells you have ever mapped.',
    metric: 'totalCells',
    tiers: [
      { threshold: 1000, points: 100 },
      { threshold: 5000, points: 100 },
      { threshold: 10000, points: 200 },
      { threshold: 25000, points: 400 },
      { threshold: 50000, points: 400 },
      { threshold: 100000, points: 400 },
    ],
  },
  {
    id: 'saddle-time',
    name: 'Saddle Time',
    description: 'Lifetime hours across eligible rides.',
    metric: 'totalHours',
    tiers: [
      { threshold: 10, points: 100 },
      { threshold: 25, points: 200 },
      { threshold: 50, points: 400 },
      { threshold: 100, points: 400 },
      { threshold: 250, points: 400 },
    ],
  },
];

export type Award = {
  achievementId: string;
  name: string;
  points: AchievementPoints;
  threshold: number;
  milestone: boolean;
};

/**
 * Evaluate every per-ride achievement against one ride's stats.
 * Returns the highest tier met per achievement (or nothing for that
 * achievement). Pure — used by both the live path and tests.
 */
export function evaluatePerRide(stats: RideAchievementStats): Award[] {
  const awards: Award[] = [];
  for (const a of PER_RIDE_ACHIEVEMENTS) {
    if (a.minDistanceMi !== undefined && stats.distanceMi < a.minDistanceMi) continue;
    if (a.maxDurationMin !== undefined && stats.durationMin > a.maxDurationMin) continue;
    const v = stats[a.metric];
    let best: Tier | null = null;
    for (const t of a.tiers) {
      const met = a.direction === 'gte' ? v >= t.threshold : v <= t.threshold;
      if (met) best = t;
    }
    if (best) {
      awards.push({
        achievementId: a.id,
        name: a.name,
        points: best.points,
        threshold: best.threshold,
        milestone: false,
      });
    }
  }
  return awards;
}

/**
 * Wipe + re-award the per-ride achievements for one ride. Mirrors
 * recomputeRideScore's idempotency: same stats in, same awards out.
 * Rows are timestamped with the ride's started_at so ordering is
 * ride-time, consistent with score_events.
 */
export async function awardRideAchievements(
  client: PoolClient,
  userId: string,
  rideUuid: string,
  startedAt: Date,
  stats: RideAchievementStats | null, // null = ride not eligible; wipe only
): Promise<Award[]> {
  await client.query(
    'DELETE FROM achievement_events WHERE ride_uuid = $1',
    [rideUuid],
  );
  if (!stats) return [];
  const awards = evaluatePerRide(stats);
  for (const aw of awards) {
    await client.query(
      `INSERT INTO achievement_events
         (user_id, ride_uuid, achievement_id, points, threshold, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, rideUuid, aw.achievementId, aw.points, aw.threshold, startedAt],
    );
  }
  return awards;
}

/**
 * Award any milestone rungs the user's cumulative stats have crossed
 * but not yet earned. Monotonic: rungs are never removed, and
 * ON CONFLICT keeps re-runs idempotent. Returns only NEWLY awarded
 * rungs (for the sync response / iOS toast).
 */
export async function awardMilestones(
  client: PoolClient,
  userId: string,
  asOf: Date,
): Promise<Award[]> {
  const agg = await client.query<{
    total_miles: number;
    total_rides: number;
    total_hours: number;
    total_cells: number;
  }>(
    `SELECT
       COALESCE(SUM(r.distance_m) / 1609.344, 0)::float8 AS total_miles,
       COUNT(*)::int AS total_rides,
       COALESCE(SUM(EXTRACT(EPOCH FROM (r.ended_at - r.started_at))) / 3600, 0)::float8 AS total_hours,
       (SELECT COUNT(DISTINCT (se.ix, se.iy)) FROM score_events se WHERE se.user_id = $1)::int AS total_cells
     FROM rides r
     JOIN users u ON u.id = r.user_id
     WHERE r.user_id = $1
       AND u.share_to_public_map = TRUE
       AND r.pocket_mode IS DISTINCT FROM TRUE`,
    [userId],
  );
  const row = agg.rows[0];
  const current: Record<MilestoneAchievement['metric'], number> = {
    totalMiles: Number(row?.total_miles ?? 0),
    totalRides: Number(row?.total_rides ?? 0),
    totalCells: Number(row?.total_cells ?? 0),
    totalHours: Number(row?.total_hours ?? 0),
  };

  const fresh: Award[] = [];
  for (const m of MILESTONE_ACHIEVEMENTS) {
    for (const t of m.tiers) {
      if (current[m.metric] < t.threshold) continue;
      const res = await client.query(
        `INSERT INTO achievement_events
           (user_id, ride_uuid, achievement_id, points, threshold, created_at)
         VALUES ($1, NULL, $2, $3, $4, $5)
         ON CONFLICT (user_id, achievement_id, threshold)
           WHERE ride_uuid IS NULL
         DO NOTHING
         RETURNING id`,
        [userId, m.id, t.points, t.threshold, asOf],
      );
      if ((res.rowCount ?? 0) > 0) {
        fresh.push({
          achievementId: m.id,
          name: m.name,
          points: t.points,
          threshold: t.threshold,
          milestone: true,
        });
      }
    }
  }
  return fresh;
}

/**
 * Recompute the cached user_scores.achievement_points. Creates the
 * user_scores row if scoring hasn't yet.
 */
export async function refreshAchievementPoints(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO user_scores (user_id, achievement_points, updated_at)
     SELECT $1::uuid,
            COALESCE((SELECT SUM(points) FROM achievement_events WHERE user_id = $1::uuid), 0),
            now()
     ON CONFLICT (user_id) DO UPDATE
       SET achievement_points = EXCLUDED.achievement_points,
           updated_at         = EXCLUDED.updated_at`,
    [userId],
  );
}

/**
 * Wipe every achievement for a user. Called when the sharing toggle
 * flips OFF — achievements are part of the score and share its
 * lifecycle ("turning sharing off resets your score to zero").
 */
export async function wipeUserAchievements(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query('DELETE FROM achievement_events WHERE user_id = $1', [
    userId,
  ]);
  await refreshAchievementPoints(client, userId);
}

/**
 * Backfill achievements for every eligible ride the user owns, plus
 * milestone rungs. Called when the sharing toggle flips ON, AFTER
 * backfillUserScores (the cell-based per-ride stats read
 * score_events). SQL mirrors the migration-0020 backfill.
 */
export async function backfillUserAchievements(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query('DELETE FROM achievement_events WHERE user_id = $1', [
    userId,
  ]);

  // Per-ride stats CTE, one row per eligible ride.
  const statsCte = `
    SELECT
      r.ride_uuid,
      r.user_id,
      r.started_at,
      r.distance_m / 1609.344 AS distance_mi,
      EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) / 60 AS duration_min,
      r.max_bumpiness AS max_bump,
      r.avg_bumpiness AS avg_bump,
      (SELECT COUNT(*) FROM ride_points rp
        WHERE rp.ride_uuid = r.ride_uuid AND rp.bumpiness >= ${HIGH_BUMP_G}) AS high_bump,
      (SELECT COUNT(*) FROM close_call_events c WHERE c.ride_uuid = r.ride_uuid) AS close_calls,
      (SELECT COUNT(*) FROM other_events o
        WHERE o.ride_uuid = r.ride_uuid AND o.is_public_eligible AND o.kind = 'blocked-lane') AS blocked_lanes,
      COALESCE((SELECT COUNT(*) FROM score_events se
        WHERE se.ride_uuid = r.ride_uuid AND se.points IN (10, 5)), 0) AS new_cells,
      COALESCE((SELECT COUNT(*) FROM score_events se
        WHERE se.ride_uuid = r.ride_uuid AND se.points IN (1, 3)), 0) AS revisits,
      COALESCE((SELECT SUM(se.points) FROM score_events se
        WHERE se.ride_uuid = r.ride_uuid), 0) AS ride_points
    FROM rides r
    JOIN users u ON u.id = r.user_id
    WHERE r.user_id = $1
      AND u.share_to_public_map = TRUE
      AND r.pocket_mode IS DISTINCT FROM TRUE
  `;

  // One INSERT per achievement: award the highest tier met. Keep the
  // CASE branches in sync with PER_RIDE_ACHIEVEMENTS above.
  const perRideInserts: Array<{ id: string; where: string; pointsCase: string; thresholdCase: string }> = [
    {
      id: 'long-haul',
      where: 'distance_mi >= 5',
      pointsCase: 'CASE WHEN distance_mi >= 15 THEN 400 WHEN distance_mi >= 10 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN distance_mi >= 15 THEN 15 WHEN distance_mi >= 10 THEN 10 ELSE 5 END',
    },
    {
      id: 'endurance',
      where: 'duration_min >= 30 AND duration_min <= 600',
      pointsCase: 'CASE WHEN duration_min >= 90 THEN 400 WHEN duration_min >= 45 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN duration_min >= 90 THEN 90 WHEN duration_min >= 45 THEN 45 ELSE 30 END',
    },
    {
      id: 'trailblazer',
      where: 'new_cells >= 250',
      pointsCase: 'CASE WHEN new_cells >= 1500 THEN 400 WHEN new_cells >= 750 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN new_cells >= 1500 THEN 1500 WHEN new_cells >= 750 THEN 750 ELSE 250 END',
    },
    {
      id: 'big-haul',
      where: 'ride_points >= 4000',
      pointsCase: 'CASE WHEN ride_points >= 15000 THEN 400 WHEN ride_points >= 8000 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN ride_points >= 15000 THEN 15000 WHEN ride_points >= 8000 THEN 8000 ELSE 4000 END',
    },
    {
      id: 'groundskeeper',
      where: 'revisits >= 750',
      pointsCase: 'CASE WHEN revisits >= 1750 THEN 400 WHEN revisits >= 1250 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN revisits >= 1750 THEN 1750 WHEN revisits >= 1250 THEN 1250 ELSE 750 END',
    },
    {
      id: 'rough-rider',
      where: 'high_bump >= 3',
      pointsCase: 'CASE WHEN high_bump >= 15 THEN 400 WHEN high_bump >= 8 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN high_bump >= 15 THEN 15 WHEN high_bump >= 8 THEN 8 ELSE 3 END',
    },
    {
      id: 'big-hit',
      where: 'max_bump >= 1.8',
      pointsCase: 'CASE WHEN max_bump >= 2.8 THEN 400 WHEN max_bump >= 2.3 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN max_bump >= 2.8 THEN 2.8 WHEN max_bump >= 2.3 THEN 2.3 ELSE 1.8 END',
    },
    {
      id: 'silk-road',
      where: 'avg_bump <= 0.25 AND distance_mi >= 2',
      pointsCase: 'CASE WHEN avg_bump <= 0.15 THEN 400 WHEN avg_bump <= 0.20 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN avg_bump <= 0.15 THEN 0.15 WHEN avg_bump <= 0.20 THEN 0.20 ELSE 0.25 END',
    },
    {
      id: 'survivor',
      where: 'close_calls >= 1',
      pointsCase: 'CASE WHEN close_calls >= 4 THEN 400 WHEN close_calls >= 2 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN close_calls >= 4 THEN 4 WHEN close_calls >= 2 THEN 2 ELSE 1 END',
    },
    {
      id: 'lane-scout',
      where: 'blocked_lanes >= 1',
      pointsCase: 'CASE WHEN blocked_lanes >= 5 THEN 400 WHEN blocked_lanes >= 3 THEN 200 ELSE 100 END',
      thresholdCase: 'CASE WHEN blocked_lanes >= 5 THEN 5 WHEN blocked_lanes >= 3 THEN 3 ELSE 1 END',
    },
  ];

  for (const ins of perRideInserts) {
    await client.query(
      `INSERT INTO achievement_events
         (user_id, ride_uuid, achievement_id, points, threshold, created_at)
       SELECT user_id, ride_uuid, '${ins.id}', ${ins.pointsCase}, ${ins.thresholdCase}, started_at
         FROM (${statsCte}) s
        WHERE ${ins.where}`,
      [userId],
    );
  }

  // Milestones as of the user's latest eligible ride.
  const latest = await client.query<{ started_at: Date }>(
    `SELECT MAX(r.started_at) AS started_at FROM rides r
      JOIN users u ON u.id = r.user_id
     WHERE r.user_id = $1 AND u.share_to_public_map = TRUE
       AND r.pocket_mode IS DISTINCT FROM TRUE`,
    [userId],
  );
  const asOf = latest.rows[0]?.started_at ?? new Date();
  await awardMilestones(client, userId, asOf);

  await refreshAchievementPoints(client, userId);
}
