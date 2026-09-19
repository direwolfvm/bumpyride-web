import type { PoolClient } from 'pg';
import {
  backfillUserAchievements,
  wipeUserAchievements,
} from '@/lib/achievements';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';

// Cell-discovery scoring primitives. Called from the ride-sync
// transaction (recomputeRideScore) and from the sharing-toggle
// transaction (wipeUserScores / backfillUserScores). All operations
// take an externally-managed PoolClient so they participate in the
// caller's transaction — the sync + toggle handlers already wrap
// everything in BEGIN/COMMIT, and scoring needs to be atomic with
// the rest of those changes.
//
// Tier ladder (also documented in migrations/0014, /0016, /0017 and
// on the /score page):
//
//   10  first user EVER to record bump data in this cell
//    5  first ride by THIS user to a cell other users already had
//    3  repeat visit to a cell whose most recent prior value — from
//       ANY user, not just this one — is more than STALE_REFRESH_DAYS
//       older than this ride. Rewards refreshing stale public data.
//    1  repeat visit to a cell someone measured within the window
//
// Anchoring: every gap comparison uses the RIDE's recorded time
// (rides.started_at), never the sync time, and tier checks only
// consider events from strictly-earlier ride times. So syncing a
// backlog in one batch yields the same tiers as syncing it live.
// score_events.created_at therefore stores the ride's started_at.
//
// FINALITY. Anchoring alone is not enough to make a score stable,
// because the tier ladder depends on OTHER riders' rows and that set
// changes over time. A rider who joins and backfills old rides adds
// events INSIDE the "before your ride" window; a rider who leaves
// removes them. Re-tiering an old ride against the current world
// therefore moved people's scores around for reasons that had
// nothing to do with them.
//
// So a (ride, cell) row is awarded once and never re-tiered. Scoring
// a ride again — re-upload, trim, split — only reconciles WHICH
// cells the ride covers:
//   - cells it no longer covers lose their row
//   - cells it still covers keep the points they already earned
//   - genuinely new cells are tiered against the world as it is now
// The unique index on (ride_uuid, ix, iy) does the work, via
// ON CONFLICT DO NOTHING.
//
// The other recompute path was the sharing toggle, which deleted
// every row on opt-out and re-derived them on opt-in. That is now a
// withdraw/restore pair, so a round trip returns the exact points
// originally awarded. A withdrawn row counts for nothing while it is
// withdrawn — not its owner's total, and not other riders' tier
// checks, since data that is not public should not stop anyone else
// from being the first public measurement of a cell.

// Threshold past which a repeat visit gets the refresh bonus. Keep
// this in sync with the same constant referenced in the migrations
// (0016, 0017) and the /score page copy.
export const STALE_REFRESH_DAYS = 10;

/**
 * Withdraw the user's score_events and refresh the cache. Used by the
 * sharing toggle when the user opts out.
 *
 * The rows are kept, not deleted, so opting back in restores the exact
 * points originally awarded (see backfillUserScores). While withdrawn
 * they are invisible everywhere: excluded from the owner's total, and
 * excluded from every other rider's tier check.
 */
export async function wipeUserScores(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE score_events SET withdrawn_at = now()
      WHERE user_id = $1 AND withdrawn_at IS NULL`,
    [userId],
  );
  // Achievements share the score lifecycle — opting out resets both.
  // They are derived from score_events, so restoring the rows on
  // opt-in reproduces the same awards.
  await wipeUserAchievements(client, userId);
  await refreshUserScoreCache(client, userId);
}

/**
 * Reconcile score_events for a single ride against the cells it now
 * covers, WITHOUT re-tiering cells it already earned.
 *
 *   - cells the ride no longer covers   -> row removed
 *   - cells it still covers             -> points left exactly as awarded
 *   - cells not scored before           -> tiered against the world now,
 *                                          anchored to startedAt
 *
 * That makes a re-upload, trim or split affect only what actually
 * changed, and makes another rider joining or leaving unable to move
 * this ride's score at all. See the finality note at the top.
 *
 * `cells` is the set of unique 20 ft cells the ride touches.
 * `startedAt` is the ride's recorded start time — all gap math is
 * anchored to it. An ineligible ride (sharing off, pocket-mode, or no
 * cells) keeps no rows: that reflects the ride's own content rather
 * than the state of the world, so it is safe to drop them.
 */
export async function recomputeRideScore(
  client: PoolClient,
  rideUuid: string,
  userId: string,
  cells: ReadonlyArray<{ ix: number; iy: number }>,
  isEligible: boolean,
  startedAt: Date,
): Promise<void> {
  const ixs = cells.map((c) => c.ix);
  const iys = cells.map((c) => c.iy);

  if (!isEligible || cells.length === 0) {
    await client.query('DELETE FROM score_events WHERE ride_uuid = $1', [
      rideUuid,
    ]);
    await refreshUserScoreCache(client, userId);
    return;
  }

  // Drop rows for cells this ride no longer covers (a trim or a
  // re-upload with a different track). Everything else survives with
  // the points it already has.
  await client.query(
    `DELETE FROM score_events se
      WHERE se.ride_uuid = $1
        AND NOT EXISTS (
          SELECT 1 FROM unnest($2::int[], $3::int[]) AS nc(ix, iy)
           WHERE nc.ix = se.ix AND nc.iy = se.iy
        )`,
    [rideUuid, ixs, iys],
  );

  // Tier only the cells that have no row yet. ON CONFLICT DO NOTHING
  // is what makes an already-awarded cell final: the CASE below never
  // gets a chance to re-decide it.
  //
  // The CASE expressions see the table state BEFORE this INSERT
  // applies (standard SQL), so the tier checks ignore rows being
  // added by this same statement. Within one ride no two rows share a
  // cell anyway (cells is deduped upstream).
  //
  // Cell coordinates are flattened into parallel int arrays so a
  // single UNNEST() drives the whole insert — the plan stays small
  // even when a ride touches thousands of cells.
  await client.query(
    `INSERT INTO score_events (user_id, ride_uuid, ix, iy, points, created_at)
     SELECT
       $1::uuid,
       $2::uuid,
       nc.ix,
       nc.iy,
       CASE
         -- 10: nobody (any rider) had recorded this cell before this
         -- ride's recorded time.
         WHEN NOT EXISTS (
           SELECT 1 FROM score_events se
            WHERE se.ix = nc.ix AND se.iy = nc.iy
              AND se.withdrawn_at IS NULL
              AND se.created_at < $5
         ) THEN 10
         -- 5: others had it, but this rider hadn't been there yet.
         WHEN NOT EXISTS (
           SELECT 1 FROM score_events se
            WHERE se.ix = nc.ix
              AND se.iy = nc.iy
              AND se.user_id = $1::uuid
              AND se.withdrawn_at IS NULL
              AND se.created_at < $5
         ) THEN 5
         -- 3: repeat visit, and NO public value (from any rider)
         -- exists within the STALE_REFRESH_DAYS window before this
         -- ride — the cell's data was stale and this ride refreshed
         -- it.
         WHEN NOT EXISTS (
           SELECT 1 FROM score_events se
            WHERE se.ix = nc.ix
              AND se.iy = nc.iy
              AND se.withdrawn_at IS NULL
              AND se.created_at < $5
              AND se.created_at > $5 - interval '${STALE_REFRESH_DAYS} days'
         ) THEN 3
         ELSE 1
       END,
       $5
     FROM unnest($3::int[], $4::int[]) AS nc(ix, iy)
     ON CONFLICT (ride_uuid, ix, iy) DO NOTHING`,
    [userId, rideUuid, ixs, iys, startedAt],
  );

  await refreshUserScoreCache(client, userId);
}

/**
 * Bring a user's scores back when the sharing toggle flips ON.
 *
 * Two distinct groups of rides, handled differently on purpose:
 *
 *  1. Rides scored before (they opted out and back in). Their rows
 *     are RESTORED verbatim — same tiers, same points as originally
 *     awarded. Re-deriving them would re-decide old rides against
 *     today's world, which is exactly the instability finality is
 *     meant to remove.
 *  2. Rides never scored at all — recorded while sharing was off, or
 *     predating the first opt-in. These have no awarded points to
 *     preserve, so they are tiered now, oldest first, so each ride
 *     sees the ones before it.
 *
 * Idempotent: safe to call when the user is already fully scored.
 */
export async function backfillUserScores(
  client: PoolClient,
  userId: string,
): Promise<void> {
  // 1. Restore.
  await client.query(
    `UPDATE score_events SET withdrawn_at = NULL
      WHERE user_id = $1 AND withdrawn_at IS NOT NULL`,
    [userId],
  );

  // 2. Score anything that never had rows. Chronological by recorded
  // ride time so the tiers match what a live in-order sync would have
  // produced. One statement per ride rather than a single window
  // query: each ride must see the rows written by the ride before it,
  // and opting in is rare enough that the extra round trips are a
  // fair trade for sharing one code path with live scoring.
  const unscored = await client.query<{ ride_uuid: string; started_at: Date }>(
    `SELECT r.ride_uuid, r.started_at
       FROM rides r
      WHERE r.user_id = $1
        AND r.pocket_mode IS DISTINCT FROM TRUE
        AND NOT EXISTS (
          SELECT 1 FROM score_events se WHERE se.ride_uuid = r.ride_uuid
        )
      ORDER BY r.started_at, r.ride_uuid`,
    [userId],
  );

  for (const row of unscored.rows) {
    const cells = await client.query<{ ix: number; iy: number }>(
      `SELECT DISTINCT
         floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
         floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy
       FROM ride_points rp
      WHERE rp.ride_uuid = $1`,
      [row.ride_uuid],
    );
    if (cells.rows.length === 0) continue;
    await recomputeRideScore(
      client,
      row.ride_uuid,
      userId,
      cells.rows.map((c) => ({ ix: Number(c.ix), iy: Number(c.iy) })),
      true,
      row.started_at,
    );
  }

  // Achievements read score_events (new-cell / revisit / ride-point
  // stats), so they backfill AFTER the score rows are in place.
  await backfillUserAchievements(client, userId);
  await refreshUserScoreCache(client, userId);
}

/**
 * Recompute the cached user_scores row from score_events. Cheap —
 * one aggregate over a (hopefully) small set of rows for the user.
 */
async function refreshUserScoreCache(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO user_scores (
       user_id, total_points,
       first_ever_count, first_user_count, stale_refresh_count, repeat_count,
       updated_at
     )
     SELECT
       $1::uuid,
       COALESCE(SUM(points), 0)::bigint,
       COUNT(*) FILTER (WHERE points = 10)::int,
       COUNT(*) FILTER (WHERE points =  5)::int,
       COUNT(*) FILTER (WHERE points =  3)::int,
       COUNT(*) FILTER (WHERE points =  1)::int,
       now()
       FROM score_events
      WHERE user_id = $1::uuid AND withdrawn_at IS NULL
     ON CONFLICT (user_id) DO UPDATE
       SET total_points        = EXCLUDED.total_points,
           first_ever_count    = EXCLUDED.first_ever_count,
           first_user_count    = EXCLUDED.first_user_count,
           stale_refresh_count = EXCLUDED.stale_refresh_count,
           repeat_count        = EXCLUDED.repeat_count,
           updated_at          = EXCLUDED.updated_at`,
    [userId],
  );
}
