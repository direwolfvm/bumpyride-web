-- Stale-refresh rework: anchor to ride time, gap vs any user.
--
-- Two defects in the original 3-point tier (migration 0016):
--
--   1. score_events.created_at was the SYNC time (default now()),
--      not the ride's recorded time. Batch syncs (e.g. the iOS
--      checksum re-sync) collapsed every gap to ~zero, so almost
--      nothing qualified as a refresh. Re-uploads also re-evaluated
--      staleness against now(), silently downgrading rides that had
--      legitimately earned the 3-point tier.
--
--   2. The gap only considered the user's OWN previous visits. The
--      intended semantic: a ride refreshes a cell when the most
--      recent prior public value — from ANY user — is more than
--      10 days older than the ride.
--
-- The code fix (src/lib/scoring.ts) now writes created_at =
-- rides.started_at and evaluates tiers only against events from
-- strictly-earlier ride times, making recomputation deterministic
-- (a refresh stays a refresh). This migration repairs existing data
-- to match:
--
--   a. Re-time every score_event to its ride's started_at.
--   b. Re-classify all 1/3-point rows with the new rule.
--   c. Refresh the user_scores cache.
--
-- 10- and 5-point rows are left untouched: first-ever / first-for-
-- you claims were decided at sync time and re-litigating them here
-- could only churn totals without improving fairness.

-- (a) Re-time to the ride's recorded start.
UPDATE score_events se
   SET created_at = r.started_at
  FROM rides r
 WHERE r.ride_uuid = se.ride_uuid
   AND se.created_at IS DISTINCT FROM r.started_at;

-- (b) Re-classify repeats. For each 1/3 row, find the most recent
-- prior event in the same cell from ANY user (strictly earlier
-- created_at, which is now ride time). Gap > 10 days → 3, else 1.
-- Rows with no prior event keep their current points (can happen
-- when the original first-ever row was deleted via account
-- deletion; nothing sensible to recompute against).
WITH prev AS (
  SELECT
    se.id,
    (
      SELECT max(p.created_at) FROM score_events p
       WHERE p.ix = se.ix AND p.iy = se.iy
         AND p.created_at < se.created_at
    ) AS prev_at
  FROM score_events se
  WHERE se.points IN (1, 3)
)
UPDATE score_events se
   SET points = CASE
     WHEN prev.prev_at IS NULL THEN se.points
     WHEN prev.prev_at < se.created_at - interval '10 days' THEN 3
     ELSE 1
   END
  FROM prev
 WHERE prev.id = se.id
   AND se.points IS DISTINCT FROM (CASE
     WHEN prev.prev_at IS NULL THEN se.points
     WHEN prev.prev_at < se.created_at - interval '10 days' THEN 3
     ELSE 1
   END);

-- (c) Refresh cached totals for every user with events.
UPDATE user_scores us
   SET total_points        = agg.total_points,
       first_ever_count    = agg.first_ever_count,
       first_user_count    = agg.first_user_count,
       stale_refresh_count = agg.stale_refresh_count,
       repeat_count        = agg.repeat_count,
       updated_at          = now()
  FROM (
    SELECT
      user_id,
      COALESCE(SUM(points), 0)::bigint         AS total_points,
      COUNT(*) FILTER (WHERE points = 10)::int AS first_ever_count,
      COUNT(*) FILTER (WHERE points =  5)::int AS first_user_count,
      COUNT(*) FILTER (WHERE points =  3)::int AS stale_refresh_count,
      COUNT(*) FILTER (WHERE points =  1)::int AS repeat_count
    FROM score_events
    GROUP BY user_id
  ) agg
 WHERE us.user_id = agg.user_id;
