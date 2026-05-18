-- Per-user "eager publish" toggle for the public bump map, plus the
-- per-cell distinct-contributor index needed to enforce the new
-- "show a cell once 3+ users have contributed" rule.
--
-- Why the change: the old threshold (`bump_cells.count >= 3`) gated on
-- the number of *points* in a cell, not distinct users. A single rider
-- on a slow street easily hit 3+ points in one cell on one ride, so the
-- threshold was effectively no protection at all. The new threshold
-- gates on distinct contributing users.
--
-- The eager-publish toggle is a deliberate escape valve: a user can opt
-- to have their contributions appear immediately (useful for seeding a
-- new region or for power users who don't mind being identifiable in
-- their own neighborhood). Default is FALSE — every new and existing
-- opt-in starts in the safer "wait for 3 users" mode.

ALTER TABLE users
  ADD COLUMN public_map_eager BOOLEAN NOT NULL DEFAULT FALSE;

-- Tracks which users have contributed to each cell. Sharing-opt-out and
-- ride re-uploads that no longer touch a cell remove the corresponding
-- rows so the distinct-user count never lags reality.
CREATE TABLE bump_cell_contributors (
  ix      INTEGER NOT NULL,
  iy      INTEGER NOT NULL,
  user_id UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (ix, iy, user_id)
);

-- For per-user cleanup on sharing-toggle-off and ride deletes.
CREATE INDEX bump_cell_contributors_user_idx
  ON bump_cell_contributors (user_id);

-- Backfill from existing data. The CELL_*_DEG constants below MUST
-- exactly match src/lib/bump-grid.ts — they're the floats computed from
--   CELL_SIZE_METERS       = 20 * 0.3048               = 6.096
--   METERS_PER_DEGREE_LAT  = 111320
--   METERS_PER_DEGREE_LON  = cos(38.9°) * 111320
-- which yields:
INSERT INTO bump_cell_contributors (ix, iy, user_id)
SELECT DISTINCT
  floor(rp.longitude / 0.0000703649615562551)::int AS ix,
  floor(rp.latitude  / 0.00005476104922745239)::int AS iy,
  r.user_id
FROM ride_points rp
JOIN rides r ON r.ride_uuid = rp.ride_uuid
JOIN users u ON u.id = r.user_id
WHERE u.share_to_public_map = TRUE
  AND r.pocket_mode IS DISTINCT FROM TRUE
ON CONFLICT DO NOTHING;
