-- Phase 5: exclude pocket-mode rides from the public aggregate.
--
-- The public bump map should reflect *calibrated* mounted-sensor data only.
-- Pocket-mode rides (and legacy rides with unknown sensing mode) are still
-- shown on each rider's personal map but are no longer contributed to
-- bump_cells.
--
-- From the application side, /api/sync/ride and /api/me/sharing only add a
-- ride's points to bump_cells when (user.share_to_public_map = true AND
-- ride.pocket_mode = false). This migration backfills the existing aggregate
-- to match: subtract any pocket-mode (true) or unknown-mode (null)
-- contributions currently in bump_cells from opted-in users.
--
-- Cell-math constants are the JS-side values from src/lib/bump-grid.ts,
-- inlined verbatim so the (ix, iy) keys here line up with the keys written
-- by /api/sync/ride and /api/me/sharing.

WITH excluded AS (
    SELECT
        floor(rp.longitude / 0.0000703649615562551::float8)::int    AS ix,
        floor(rp.latitude  / 0.00005476104922745239::float8)::int   AS iy,
        SUM(rp.bumpiness) AS sum_delta,
        COUNT(*)::bigint  AS count_delta
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE u.share_to_public_map = TRUE
      AND r.pocket_mode IS DISTINCT FROM FALSE  -- TRUE or NULL
    GROUP BY ix, iy
)
UPDATE bump_cells
   SET sum   = bump_cells.sum   - excluded.sum_delta,
       count = bump_cells.count - excluded.count_delta
  FROM excluded
 WHERE bump_cells.ix = excluded.ix
   AND bump_cells.iy = excluded.iy;

DELETE FROM bump_cells WHERE count <= 0;
