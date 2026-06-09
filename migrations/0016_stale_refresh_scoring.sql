-- Stale-refresh scoring tier.
--
-- Adds a 4th tier between "first visit by this user" (5) and "ordinary
-- repeat" (1):
--
--   3 — a ride to a cell the user has been in before, but whose
--       previous visit by this user was more than 10 days ago.
--
-- Motivation: a cell that hasn't been measured in a while is more
-- valuable to re-measure than one the user just rode through yesterday.
-- Rewarding refreshes nudges users toward keeping their coverage
-- current without devaluing the original-discovery tiers.
--
-- Eligibility is unchanged — only mounted-mode rides by users with
-- public sharing on count, same as the other tiers.

-- Replace the points CHECK with the expanded set.
ALTER TABLE score_events
  DROP CONSTRAINT score_events_points_check;
ALTER TABLE score_events
  ADD CONSTRAINT score_events_points_check
  CHECK (points IN (1, 3, 5, 10));

-- New per-user counter alongside the existing three.
ALTER TABLE user_scores
  ADD COLUMN stale_refresh_count INTEGER NOT NULL DEFAULT 0;

-- Re-classify existing 1-point rows that *should* have been 3. For
-- every (user, cell), walk score_events in chronological order and
-- promote any row whose gap from the previous same-user row in the
-- same cell exceeds 10 days. The first row per (user, cell) keeps
-- its original tier (10 or 5) — only repeat rows are touched.
--
-- We use lag(created_at) over the per-(user, cell) window. The first
-- row's lag is NULL, so the WHERE clause naturally excludes it.
WITH gaps AS (
  SELECT
    id,
    created_at - lag(created_at) OVER (
      PARTITION BY user_id, ix, iy
      ORDER BY created_at
    ) AS gap
  FROM score_events
)
UPDATE score_events se
   SET points = 3
  FROM gaps g
 WHERE se.id = g.id
   AND se.points = 1
   AND g.gap > interval '10 days';

-- Refresh the cached totals to pick up the re-classification.
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
      COALESCE(SUM(points), 0)::bigint                        AS total_points,
      COUNT(*) FILTER (WHERE points = 10)::int                AS first_ever_count,
      COUNT(*) FILTER (WHERE points =  5)::int                AS first_user_count,
      COUNT(*) FILTER (WHERE points =  3)::int                AS stale_refresh_count,
      COUNT(*) FILTER (WHERE points =  1)::int                AS repeat_count
    FROM score_events
    GROUP BY user_id
  ) agg
 WHERE us.user_id = agg.user_id;
