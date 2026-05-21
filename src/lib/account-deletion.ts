import type { PoolClient } from 'pg';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';

// Primitives shared by /api/me/clear-data and /api/me/delete-account.
//
// Four user-facing combinations, all built from three building blocks:
//
//   clear-data,   keep-public  -> orphanUserRides + reset calibration
//   clear-data,   drop-public  -> dropUserPublicContributions + reset
//   delete-acct,  keep-public  -> orphanUserRides + DELETE users
//   delete-acct,  drop-public  -> dropUserPublicContributions + DELETE users
//
// "Drop" subtracts the user's bumpiness contributions from bump_cells
// (mirroring the sharing-toggle-off path in /api/me/sharing) and lets
// the rides cascade-delete. "Keep" leaves bump_cells alone and just
// reassigns the rides + bump_cell_contributors rows to a fresh
// anonymized user — so the public maps stay intact, but nothing on
// them is linkable to the original account.
//
// All operations run inside a single transaction so a partial failure
// leaves bump_cells consistent with rides.

const SYNTHETIC_EMAIL_DOMAIN = 'anon.bumpyride.invalid';

function syntheticAnonymizedEmail(): string {
  // crypto.randomUUID is available in Node 19+ globally. The `.invalid`
  // TLD is reserved (RFC 2606) so no real account can ever collide,
  // and the per-row UUID makes the column-level uniqueness constraint
  // safe to keep without collision risk.
  const id = crypto.randomUUID();
  return `anon-${id}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

async function isUserSharing(client: PoolClient, userId: string): Promise<boolean> {
  const res = await client.query<{ share_to_public_map: boolean }>(
    'SELECT share_to_public_map FROM users WHERE id = $1',
    [userId],
  );
  return res.rows[0]?.share_to_public_map ?? false;
}

/**
 * Mints a brand-new users row with `anonymized_at = now()` and
 * `share_to_public_map = true` (so the orphan-owned rides keep flowing
 * into the public aggregate). The synthetic email is unique by UUID
 * construction. Returns the new id.
 */
async function mintAnonymizedUser(client: PoolClient): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO users (email, share_to_public_map, public_map_eager, anonymized_at)
     VALUES ($1, TRUE, FALSE, now())
     RETURNING id`,
    [syntheticAnonymizedEmail()],
  );
  return res.rows[0].id;
}

/**
 * Reassign every ride + per-cell contributor row from `userId` to a
 * freshly minted anonymized user. Caller is responsible for the
 * outer transaction. Returns the anon user id (mostly for telemetry).
 */
async function orphanUserRides(
  client: PoolClient,
  userId: string,
): Promise<{ anonUserId: string; rides: number; contributors: number }> {
  const anonId = await mintAnonymizedUser(client);
  const rides = await client.query<{ ride_uuid: string }>(
    'UPDATE rides SET user_id = $2 WHERE user_id = $1 RETURNING ride_uuid',
    [userId, anonId],
  );
  const contribs = await client.query<{ ix: number }>(
    'UPDATE bump_cell_contributors SET user_id = $2 WHERE user_id = $1 RETURNING ix',
    [userId, anonId],
  );
  return {
    anonUserId: anonId,
    rides: rides.rowCount ?? 0,
    contributors: contribs.rowCount ?? 0,
  };
}

/**
 * Subtract `userId`'s bumpiness contributions from bump_cells, then
 * drop their per-cell contributor rows. Mirror image of the opt-in
 * INSERT performed in /api/me/sharing PATCH. Idempotent on no-data.
 *
 * Caller is responsible for actually deleting the rides afterwards
 * (or letting them cascade-delete via the users row).
 */
async function dropUserPublicContributions(
  client: PoolClient,
  userId: string,
): Promise<void> {
  // Same eligibility CTE as /api/me/sharing: mounted-or-legacy rides
  // only. Embedding the cell-degree constants matches the JS-side
  // BumpGrid math exactly.
  const eligibleCte = `
    WITH user_cells AS (
      SELECT
        floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
        floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
        SUM(rp.bumpiness) AS sum_delta,
        COUNT(*)::bigint  AS count_delta
      FROM ride_points rp
      JOIN rides r ON r.ride_uuid = rp.ride_uuid
      WHERE r.user_id = $1
        AND r.pocket_mode IS DISTINCT FROM TRUE
      GROUP BY ix, iy
    )
  `;
  await client.query(
    `${eligibleCte}
     UPDATE bump_cells
        SET sum   = bump_cells.sum   - user_cells.sum_delta,
            count = bump_cells.count - user_cells.count_delta
       FROM user_cells
      WHERE bump_cells.ix = user_cells.ix
        AND bump_cells.iy = user_cells.iy`,
    [userId],
  );
  await client.query('DELETE FROM bump_cells WHERE count <= 0');
  await client.query(
    'DELETE FROM bump_cell_contributors WHERE user_id = $1',
    [userId],
  );
}

/**
 * Reset the per-rider pocket calibration to defaults. Called after
 * clearing data so a future ride doesn't get scaled by stale gain.
 */
async function resetCalibration(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE users
        SET pocket_gain = 1.0,
            pocket_confidence = 0,
            pocket_calibration_at = NULL
      WHERE id = $1`,
    [userId],
  );
}

export type ClearOutcome = {
  ridesOrphaned: number;
  ridesDeleted: number;
  anonUserId: string | null;
};

export type DeletionMode = { keepPublicContributions: boolean };

/**
 * Clear every ride this user owns. Behavior diverges on `keep`:
 *  - keep:  rides + per-cell contributor rows reassigned to a new
 *           anonymized user. bump_cells aggregate untouched.
 *  - drop:  bumpiness contributions subtracted from bump_cells, then
 *           the user's contributor rows + rides are cascade-deleted.
 *
 * When the user was never sharing to public maps, the "keep" option
 * collapses to a plain cascade-delete of their rides since there's
 * nothing in bump_cells to preserve.
 */
export async function clearUserData(
  userId: string,
  { keepPublicContributions }: DeletionMode,
): Promise<ClearOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sharing = await isUserSharing(client, userId);
    let outcome: ClearOutcome;
    if (keepPublicContributions && sharing) {
      const orphan = await orphanUserRides(client, userId);
      outcome = {
        ridesOrphaned: orphan.rides,
        ridesDeleted: 0,
        anonUserId: orphan.anonUserId,
      };
    } else {
      if (sharing) {
        await dropUserPublicContributions(client, userId);
      }
      // ride_points / brake_events / close_call_events cascade-delete
      // via the rides FK. bump_cell_contributors handled above when
      // sharing was on; when off, there are no rows to drop.
      const deleted = await client.query(
        'DELETE FROM rides WHERE user_id = $1 RETURNING ride_uuid',
        [userId],
      );
      outcome = {
        ridesOrphaned: 0,
        ridesDeleted: deleted.rowCount ?? 0,
        anonUserId: null,
      };
    }
    await resetCalibration(client, userId);
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Full account teardown: composes clearUserData with a DELETE of the
 * users row itself, which cascades to accounts (OAuth), sessions,
 * api_tokens, recovery_codes. Idempotent — calling twice on the same
 * id is harmless once the row is gone.
 */
export async function deleteUserAccount(
  userId: string,
  mode: DeletionMode,
): Promise<ClearOutcome> {
  const outcome = await clearUserData(userId, mode);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  return outcome;
}
