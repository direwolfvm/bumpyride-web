-- Achievements: repeatable per-ride awards + one-time milestone
-- rungs, at fixed 100 / 200 / 400-point tiers. Calibrated against a
-- real 150-ride corpus so achievements land ~10% of a normal rider's
-- combined total. Registry + tier thresholds live in
-- src/lib/achievements.ts; iOS contract in
-- bumpy-ride/docs/ACHIEVEMENTS_IOS_HANDOFF.md.
--
-- Row shapes:
--   ride_uuid IS NOT NULL -> per-ride award. At most one row per
--     (ride, achievement); wiped + re-awarded when the ride re-syncs
--     (same lifecycle as score_events). created_at = ride started_at.
--   ride_uuid IS NULL     -> milestone rung. One row per
--     (user, achievement, threshold); monotonic — never revoked by
--     later edits. created_at = started_at of the ride whose sync
--     crossed the rung.
--
-- Eligibility matches cell-discovery scoring: sharing ON,
-- mounted-or-legacy rides. Achievements share the score lifecycle —
-- wiped on sharing opt-out, backfilled on opt-in.

CREATE TABLE achievement_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_uuid      UUID REFERENCES rides(ride_uuid) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  points         SMALLINT NOT NULL CHECK (points IN (100, 200, 400)),
  threshold      DOUBLE PRECISION NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL
);

-- One award per achievement per ride.
CREATE UNIQUE INDEX achievement_events_ride_achievement_key
  ON achievement_events (ride_uuid, achievement_id)
  WHERE ride_uuid IS NOT NULL;

-- One rung per (user, achievement, threshold) for milestones.
CREATE UNIQUE INDEX achievement_events_user_milestone_key
  ON achievement_events (user_id, achievement_id, threshold)
  WHERE ride_uuid IS NULL;

-- The /score page + /api/me/achievements list in ride-time order.
CREATE INDEX achievement_events_user_created_idx
  ON achievement_events (user_id, created_at DESC);

ALTER TABLE user_scores
  ADD COLUMN achievement_points BIGINT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Backfill for every sharing-on user. Mirrors
-- backfillUserAchievements() in src/lib/achievements.ts — keep the
-- CASE ladders in sync with PER_RIDE_ACHIEVEMENTS /
-- MILESTONE_ACHIEVEMENTS there.

WITH stats AS (
  SELECT
    r.ride_uuid,
    r.user_id,
    r.started_at,
    r.distance_m / 1609.344 AS distance_mi,
    EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) / 60 AS duration_min,
    r.max_bumpiness AS max_bump,
    r.avg_bumpiness AS avg_bump,
    (SELECT COUNT(*) FROM ride_points rp
      WHERE rp.ride_uuid = r.ride_uuid AND rp.bumpiness >= 1.5) AS high_bump,
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
  WHERE u.share_to_public_map = TRUE
    AND r.pocket_mode IS DISTINCT FROM TRUE
),
awards AS (
  SELECT user_id, ride_uuid, 'long-haul' AS aid,
    CASE WHEN distance_mi >= 15 THEN 400 WHEN distance_mi >= 10 THEN 200 ELSE 100 END AS pts,
    CASE WHEN distance_mi >= 15 THEN 15 WHEN distance_mi >= 10 THEN 10 ELSE 5 END AS thr,
    started_at FROM stats WHERE distance_mi >= 5
  UNION ALL
  SELECT user_id, ride_uuid, 'endurance',
    CASE WHEN duration_min >= 90 THEN 400 WHEN duration_min >= 45 THEN 200 ELSE 100 END,
    CASE WHEN duration_min >= 90 THEN 90 WHEN duration_min >= 45 THEN 45 ELSE 30 END,
    started_at FROM stats WHERE duration_min >= 30 AND duration_min <= 600
  UNION ALL
  SELECT user_id, ride_uuid, 'trailblazer',
    CASE WHEN new_cells >= 1500 THEN 400 WHEN new_cells >= 750 THEN 200 ELSE 100 END,
    CASE WHEN new_cells >= 1500 THEN 1500 WHEN new_cells >= 750 THEN 750 ELSE 250 END,
    started_at FROM stats WHERE new_cells >= 250
  UNION ALL
  SELECT user_id, ride_uuid, 'big-haul',
    CASE WHEN ride_points >= 15000 THEN 400 WHEN ride_points >= 8000 THEN 200 ELSE 100 END,
    CASE WHEN ride_points >= 15000 THEN 15000 WHEN ride_points >= 8000 THEN 8000 ELSE 4000 END,
    started_at FROM stats WHERE ride_points >= 4000
  UNION ALL
  SELECT user_id, ride_uuid, 'groundskeeper',
    CASE WHEN revisits >= 1750 THEN 400 WHEN revisits >= 1250 THEN 200 ELSE 100 END,
    CASE WHEN revisits >= 1750 THEN 1750 WHEN revisits >= 1250 THEN 1250 ELSE 750 END,
    started_at FROM stats WHERE revisits >= 750
  UNION ALL
  SELECT user_id, ride_uuid, 'rough-rider',
    CASE WHEN high_bump >= 15 THEN 400 WHEN high_bump >= 8 THEN 200 ELSE 100 END,
    CASE WHEN high_bump >= 15 THEN 15 WHEN high_bump >= 8 THEN 8 ELSE 3 END,
    started_at FROM stats WHERE high_bump >= 3
  UNION ALL
  SELECT user_id, ride_uuid, 'big-hit',
    CASE WHEN max_bump >= 2.8 THEN 400 WHEN max_bump >= 2.3 THEN 200 ELSE 100 END,
    CASE WHEN max_bump >= 2.8 THEN 2.8 WHEN max_bump >= 2.3 THEN 2.3 ELSE 1.8 END,
    started_at FROM stats WHERE max_bump >= 1.8
  UNION ALL
  SELECT user_id, ride_uuid, 'silk-road',
    CASE WHEN avg_bump <= 0.15 THEN 400 WHEN avg_bump <= 0.20 THEN 200 ELSE 100 END,
    CASE WHEN avg_bump <= 0.15 THEN 0.15 WHEN avg_bump <= 0.20 THEN 0.20 ELSE 0.25 END,
    started_at FROM stats WHERE avg_bump <= 0.25 AND distance_mi >= 2
  UNION ALL
  SELECT user_id, ride_uuid, 'survivor',
    CASE WHEN close_calls >= 4 THEN 400 WHEN close_calls >= 2 THEN 200 ELSE 100 END,
    CASE WHEN close_calls >= 4 THEN 4 WHEN close_calls >= 2 THEN 2 ELSE 1 END,
    started_at FROM stats WHERE close_calls >= 1
  UNION ALL
  SELECT user_id, ride_uuid, 'lane-scout',
    CASE WHEN blocked_lanes >= 5 THEN 400 WHEN blocked_lanes >= 3 THEN 200 ELSE 100 END,
    CASE WHEN blocked_lanes >= 5 THEN 5 WHEN blocked_lanes >= 3 THEN 3 ELSE 1 END,
    started_at FROM stats WHERE blocked_lanes >= 1
)
INSERT INTO achievement_events (user_id, ride_uuid, achievement_id, points, threshold, created_at)
SELECT user_id, ride_uuid, aid, pts, thr, started_at FROM awards;

-- Milestone rungs per user. Cumulative aggregates over eligible
-- rides; award every rung at or below the current value. created_at
-- = the user's latest eligible ride time.
WITH agg AS (
  SELECT
    r.user_id,
    SUM(r.distance_m) / 1609.344 AS total_miles,
    COUNT(*) AS total_rides,
    SUM(EXTRACT(EPOCH FROM (r.ended_at - r.started_at))) / 3600 AS total_hours,
    MAX(r.started_at) AS latest,
    (SELECT COUNT(DISTINCT (se.ix, se.iy)) FROM score_events se
      WHERE se.user_id = r.user_id) AS total_cells
  FROM rides r
  JOIN users u ON u.id = r.user_id
  WHERE u.share_to_public_map = TRUE
    AND r.pocket_mode IS DISTINCT FROM TRUE
  GROUP BY r.user_id
),
rungs AS (
  SELECT * FROM (VALUES
    ('odometer',    25::float8, 100), ('odometer',    50, 100), ('odometer',   100, 200),
    ('odometer',   200, 200), ('odometer',   400, 400), ('odometer',   800, 400),
    ('odometer',  1600, 400), ('odometer',  3200, 400),
    ('ride-tally',  10, 100), ('ride-tally',  25, 100), ('ride-tally',  50, 200),
    ('ride-tally', 100, 200), ('ride-tally', 250, 400), ('ride-tally', 500, 400),
    ('ride-tally',1000, 400),
    ('atlas',     1000, 100), ('atlas',     5000, 100), ('atlas',    10000, 200),
    ('atlas',    25000, 400), ('atlas',    50000, 400), ('atlas',   100000, 400),
    ('saddle-time', 10, 100), ('saddle-time', 25, 200), ('saddle-time', 50, 400),
    ('saddle-time',100, 400), ('saddle-time',250, 400)
  ) AS v(aid, thr, pts)
)
INSERT INTO achievement_events (user_id, ride_uuid, achievement_id, points, threshold, created_at)
SELECT a.user_id, NULL, r.aid, r.pts, r.thr, a.latest
FROM agg a
JOIN rungs r ON (
  (r.aid = 'odometer'    AND a.total_miles >= r.thr) OR
  (r.aid = 'ride-tally'  AND a.total_rides >= r.thr) OR
  (r.aid = 'atlas'       AND a.total_cells >= r.thr) OR
  (r.aid = 'saddle-time' AND a.total_hours >= r.thr)
);

-- Refresh the cached achievement totals.
UPDATE user_scores us
   SET achievement_points = COALESCE(agg.pts, 0),
       updated_at = now()
  FROM (
    SELECT user_id, SUM(points) AS pts
    FROM achievement_events GROUP BY user_id
  ) agg
 WHERE us.user_id = agg.user_id;
