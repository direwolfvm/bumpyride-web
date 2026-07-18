import type { PoolClient } from 'pg';
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
// consider events from strictly-earlier ride times. Two important
// consequences:
//   - Syncing a backlog of rides in one batch still yields the same
//     tiers as syncing them live, because the recorded ride times
//     carry the real gaps.
//   - Recomputing a ride (re-upload) is deterministic: it sees the
//     exact same "prior events" set every time, so a ride that
//     earned a refresh keeps it. Later rides can never retroactively
//     downgrade an earlier ride's tier.
// score_events.created_at therefore stores the ride's started_at.

// Threshold past which a repeat visit gets the refresh bonus. Keep
// this in sync with the same constant referenced in the migrations
// (0016, 0017) and the /score page copy.
export const STALE_REFRESH_DAYS = 10;

/**
 * Wipe the user's existing score_events and recompute the user_scores
 * cache. Used by the sharing toggle when the user opts out of public
 * sharing.
 */
export async function wipeUserScores(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query('DELETE FROM score_events WHERE user_id = $1', [userId]);
  await refreshUserScoreCache(client, userId);
}

/**
 * Recompute score_events for a single ride. Always idempotent: wipes
 * the ride's existing rows first, then assigns tiers against events
 * from strictly-earlier ride times (excluding the rows we just
 * deleted). Because the evaluation window never includes later
 * events, re-running this for the same ride always produces the
 * same tiers — a refresh stays a refresh.
 *
 * `cells` is the set of unique 20 ft cells the new ride touches.
 * `startedAt` is the ride's recorded start time — all gap math is
 * anchored to it. If the ride is not eligible (sharing off,
 * pocket-mode ride, or empty cell set) the rows just get wiped and
 * we refresh the cache.
 */
export async function recomputeRideScore(
  client: PoolClient,
  rideUuid: string,
  userId: string,
  cells: ReadonlyArray<{ ix: number; iy: number }>,
  isEligible: boolean,
  startedAt: Date,
): Promise<void> {
  await client.query('DELETE FROM score_events WHERE ride_uuid = $1', [
    rideUuid,
  ]);

  if (isEligible && cells.length > 0) {
    // Bulk-insert via VALUES + CASE. The CASE expressions in the
    // SELECT see the table state BEFORE the INSERT applies (standard
    // SQL semantics), so each tier check ignores rows we're about to
    // add in the same statement. Within a single ride, no two rows
    // share a cell anyway (cells is deduped upstream).
    //
    // Cell coordinates are flattened to alternating ix, iy params so
    // we can drive a single UNNEST() of integer arrays — keeps the
    // query plan small even when cells.length runs into the hundreds.
    const ixs = cells.map((c) => c.ix);
    const iys = cells.map((c) => c.iy);
    await client.query(
      `INSERT INTO score_events (user_id, ride_uuid, ix, iy, points, created_at)
       SELECT
         $1::uuid,
         $2::uuid,
         nc.ix,
         nc.iy,
         CASE
           -- 10: nobody (any user) had recorded this cell before this
           -- ride's recorded time.
           WHEN NOT EXISTS (
             SELECT 1 FROM score_events se
              WHERE se.ix = nc.ix AND se.iy = nc.iy
                AND se.created_at < $5
           ) THEN 10
           -- 5: others had it, but this user hadn't been there yet.
           WHEN NOT EXISTS (
             SELECT 1 FROM score_events se
              WHERE se.ix = nc.ix
                AND se.iy = nc.iy
                AND se.user_id = $1::uuid
                AND se.created_at < $5
           ) THEN 5
           -- 3: repeat visit, and NO public value (from any user)
           -- exists within the STALE_REFRESH_DAYS window before this
           -- ride — the cell's data was stale and this ride
           -- refreshed it.
           WHEN NOT EXISTS (
             SELECT 1 FROM score_events se
              WHERE se.ix = nc.ix
                AND se.iy = nc.iy
                AND se.created_at < $5
                AND se.created_at > $5 - interval '${STALE_REFRESH_DAYS} days'
           ) THEN 3
           ELSE 1
         END,
         $5
       FROM unnest($3::int[], $4::int[]) AS nc(ix, iy)`,
      [userId, rideUuid, ixs, iys, startedAt],
    );
  }

  await refreshUserScoreCache(client, userId);
}

/**
 * Backfill score_events for every eligible ride this user owns,
 * processed chronologically so each ride gets the right tier
 * relative to the user's earlier rides AND any other users who were
 * already in the dataset. Used when the sharing toggle flips ON.
 *
 * Idempotent on no data; safe to call when the user already has
 * score_events (the matching ride_uuids get wiped first, then
 * recomputed in order).
 */
export async function backfillUserScores(
  client: PoolClient,
  userId: string,
): Promise<void> {
  // Wipe any leftover rows for this user (shouldn't be any on a fresh
  // opt-in, but defensive).
  await client.query('DELETE FROM score_events WHERE user_id = $1', [userId]);

  // Single big window-function INSERT — same shape as the migration
  // backfill but scoped to one user. Rides are ordered by their
  // RECORDED time (started_at) so the backfill assigns the same
  // tiers a live in-order sync would have.
  await client.query(
    `INSERT INTO score_events (user_id, ride_uuid, ix, iy, points, created_at)
     WITH ride_cells AS (
       SELECT DISTINCT
         r.ride_uuid,
         r.started_at,
         floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
         floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy
       FROM ride_points rp
       JOIN rides r ON r.ride_uuid = rp.ride_uuid
       WHERE r.user_id = $1
         AND r.pocket_mode IS DISTINCT FROM TRUE
     ),
     ranked AS (
       SELECT
         rc.*,
         -- "First ever" claims for an opting-back-in user are
         -- evaluated against the CURRENT score_events state, not the
         -- original sync timeline: a user who opted out forfeited
         -- their priority. So if any OTHER user has a row for this
         -- cell when the backfill runs — regardless of its time —
         -- this user can't claim 10 points for it; they slot in at
         -- the 5-point tier (or 1/3 for repeats).
         EXISTS (
           SELECT 1 FROM score_events se
            WHERE se.ix = rc.ix AND se.iy = rc.iy
              AND se.user_id <> $1
         ) AS other_user_has_cell,
         -- Most recent prior public value from any OTHER user,
         -- strictly before this ride's recorded time. Combined with
         -- lag() over the user's own rides to find the latest prior
         -- value overall for the refresh-gap check.
         (
           SELECT max(se.created_at) FROM score_events se
            WHERE se.ix = rc.ix AND se.iy = rc.iy
              AND se.user_id <> $1
              AND se.created_at < rc.started_at
         ) AS others_prev_at,
         lag(started_at) OVER (
           PARTITION BY ix, iy
           ORDER BY started_at, ride_uuid
         ) AS own_prev_at,
         rank() OVER (
           PARTITION BY ix, iy
           ORDER BY started_at, ride_uuid
         ) AS user_rank
       FROM ride_cells rc
     )
     SELECT
       $1::uuid,
       ride_uuid,
       ix,
       iy,
       CASE
         WHEN user_rank = 1 AND NOT other_user_has_cell THEN 10
         WHEN user_rank = 1                             THEN 5
         -- Repeat: refresh iff the latest prior value in the cell —
         -- own or anyone else's — is more than the window before
         -- this ride's recorded time.
         WHEN GREATEST(
                COALESCE(own_prev_at,    timestamptz '-infinity'),
                COALESCE(others_prev_at, timestamptz '-infinity')
              ) < started_at - interval '${STALE_REFRESH_DAYS} days' THEN 3
         ELSE 1
       END,
       started_at
     FROM ranked`,
    [userId],
  );

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
      WHERE user_id = $1::uuid
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
