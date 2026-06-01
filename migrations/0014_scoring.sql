-- Cell-discovery scoring.
--
-- Awards points for contributing bump data to 20 ft cells:
--   10 — first user EVER to record in this cell
--    5 — first ride by this user to a cell that other users already had
--    1 — every later ride by the user that revisits a cell they've been in
--
-- Eligibility matches the public bump-map gate: user.share_to_public_map
-- = TRUE AND ride.pocket_mode IS DISTINCT FROM TRUE. Brake and close-call
-- data does NOT count — only bumpiness samples drive the score.
--
-- score_events is the source of truth: one row per (ride, cell) pair the
-- ride contributed to, with the awarded tier baked in. user_scores caches
-- the per-user totals so the score page + API don't re-aggregate on every
-- read.

CREATE TABLE score_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_uuid   UUID NOT NULL REFERENCES rides(ride_uuid) ON DELETE CASCADE,
  ix          INTEGER NOT NULL,
  iy          INTEGER NOT NULL,
  points      SMALLINT NOT NULL CHECK (points IN (1, 5, 10)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_uuid, ix, iy)
);

-- Tier computation per sync needs:
--   "Is there any score_event for this cell from any user?" -> use cell idx.
--   "Is there any score_event for (this cell, this user)?"   -> use user+cell idx.
CREATE INDEX score_events_cell_idx ON score_events (ix, iy);
CREATE INDEX score_events_user_cell_idx ON score_events (user_id, ix, iy);

CREATE TABLE user_scores (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_points       BIGINT  NOT NULL DEFAULT 0,
  first_ever_count   INTEGER NOT NULL DEFAULT 0,
  first_user_count   INTEGER NOT NULL DEFAULT 0,
  repeat_count       INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill from existing rides. For every eligible (user, ride, cell)
-- tuple, assign a tier based on chronological ranking:
--   - earliest ride to a cell (across all users)  -> 10
--   - earliest ride by THIS user to the cell      -> 5
--   - everything later                            -> 1
-- Ties break by (user_id, ride_uuid) for determinism.
INSERT INTO score_events (user_id, ride_uuid, ix, iy, points, created_at)
WITH ride_cells AS (
  SELECT DISTINCT
    r.user_id,
    r.ride_uuid,
    r.created_at,
    floor(rp.longitude / 0.0000703649615562551)::int AS ix,
    floor(rp.latitude  / 0.00005476104922745239)::int AS iy
  FROM ride_points rp
  JOIN rides r ON r.ride_uuid = rp.ride_uuid
  JOIN users u ON u.id = r.user_id
  WHERE u.share_to_public_map = TRUE
    AND r.pocket_mode IS DISTINCT FROM TRUE
),
ranked AS (
  SELECT
    *,
    rank() OVER (
      PARTITION BY ix, iy
      ORDER BY created_at, user_id, ride_uuid
    ) AS global_rank,
    rank() OVER (
      PARTITION BY user_id, ix, iy
      ORDER BY created_at, ride_uuid
    ) AS user_rank
  FROM ride_cells
)
SELECT
  user_id,
  ride_uuid,
  ix,
  iy,
  CASE
    WHEN global_rank = 1 THEN 10
    WHEN user_rank   = 1 THEN 5
    ELSE 1
  END,
  created_at
FROM ranked;

-- Roll up to user_scores so the score page is a single-row read.
INSERT INTO user_scores (user_id, total_points, first_ever_count, first_user_count, repeat_count)
SELECT
  user_id,
  SUM(points)::bigint,
  COUNT(*) FILTER (WHERE points = 10)::int,
  COUNT(*) FILTER (WHERE points =  5)::int,
  COUNT(*) FILTER (WHERE points =  1)::int
FROM score_events
GROUP BY user_id;
