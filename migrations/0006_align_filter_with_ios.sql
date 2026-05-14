-- Phase 7: align bump-cell aggregation with the iOS Bump Map filter.
--
-- iOS ships a three-option filter (All / Mounted / Pocket) with Mounted
-- as the default — and treats legacy rides with `pocketMode IS NULL` as
-- mounted (early users almost universally had handlebar mounts; bucketing
-- them with mounted matches reality and doesn't penalise no-recourse).
--
-- This migration changes the policy that backs the public /map:
--
--   v1 (migration 0004):  mounted (pocket_mode = FALSE) only
--   v2 (calibration PR):  mounted + calibrated-pocket (gain-scaled when
--                          user.pocket_confidence >= 3)
--   v3 (this migration):  mounted + null  (pocket_mode IS DISTINCT FROM TRUE)
--                          — calibrated pocket data no longer contributes
--                            to the public aggregate (the iOS-side spec
--                            calls for shipping the simple version first;
--                            we may revisit once a critical mass of users
--                            have confident calibrations).
--
-- The personal map (/api/tiles/user/...) is unaffected by this migration.
-- It still aggregates on demand from ride_points and continues to apply
-- the rider's pocket_gain to pocket-mode samples when their calibration
-- is in effect, independent of the visibility filter.
--
-- Rebuild approach: TRUNCATE bump_cells and recompute from the source
-- tables under the new invariant in a single statement. Cheaper to reason
-- about than surgical deltas and atomic by construction.

TRUNCATE bump_cells;

INSERT INTO bump_cells (ix, iy, sum, count)
    SELECT
        floor(rp.longitude / 0.0000703649615562551::float8)::int    AS ix,
        floor(rp.latitude  / 0.00005476104922745239::float8)::int   AS iy,
        SUM(rp.bumpiness)                                            AS sum,
        COUNT(*)::bigint                                             AS count
    FROM ride_points rp
    JOIN rides r ON r.ride_uuid = rp.ride_uuid
    JOIN users u ON u.id = r.user_id
    WHERE u.share_to_public_map = TRUE
      AND r.pocket_mode IS DISTINCT FROM TRUE  -- false or null
    GROUP BY ix, iy;
