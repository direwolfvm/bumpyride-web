import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import { CONFIDENCE_FLOOR } from '@/lib/calibration';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Both methods accept either a web session cookie or a Bearer API token,
// so the iOS app can read + write the user's privacy preference using the
// same token it uses for ride sync. Last-write-wins between iOS and web;
// the operation is idempotent on state.

const patchSchema = z.object({
  shareToPublicMap: z.boolean(),
});

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const res = await pool.query<{ share_to_public_map: boolean }>(
    'SELECT share_to_public_map FROM users WHERE id = $1',
    [userId],
  );
  return NextResponse.json({
    shareToPublicMap: res.rows[0]?.share_to_public_map ?? false,
  });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // Backfill / subtract the user's contributions to bump_cells so the
  // invariant
  //   bump_cells = SUM of ride_points belonging to opted-in users
  // holds at all times. A user toggling on/off doesn't strand stale data
  // either direction.
  //
  // The CELL_*_DEG constants are JS-side; embed as literals so the query
  // plan stays cacheable and matches the iOS BumpGrid math exactly.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{ share_to_public_map: boolean }>(
      'SELECT share_to_public_map FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const wasOptedIn = current.rows[0]?.share_to_public_map ?? false;

    if (wasOptedIn === body.shareToPublicMap) {
      await client.query('COMMIT');
      return NextResponse.json({ shareToPublicMap: wasOptedIn, changed: false });
    }

    await client.query(
      'UPDATE users SET share_to_public_map = $1 WHERE id = $2',
      [body.shareToPublicMap, userId],
    );

    // The eligibility expression is shared between the opt-in (INSERT)
    // and opt-out (UPDATE … SET ... -) paths: mounted rides always
    // contribute raw, pocket rides contribute only when the rider's
    // calibration is in effect (confidence >= CONFIDENCE_FLOOR), and the
    // applied multiplier is then the rider's pocket_gain. Legacy rides
    // (pocket_mode IS NULL) never contribute.
    //
    // Both queries source the same CTE; the only difference is whether
    // sum/count get added (opt-in) or subtracted (opt-out).
    const eligibleCte = `
      WITH user_cells AS (
        SELECT
          floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
          floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
          SUM(
            CASE
              WHEN r.pocket_mode = FALSE THEN rp.bumpiness
              WHEN r.pocket_mode = TRUE AND u.pocket_confidence >= ${CONFIDENCE_FLOOR}
                THEN rp.bumpiness * u.pocket_gain
              ELSE 0
            END
          ) AS sum_delta,
          SUM(
            CASE
              WHEN r.pocket_mode = FALSE THEN 1
              WHEN r.pocket_mode = TRUE AND u.pocket_confidence >= ${CONFIDENCE_FLOOR}
                THEN 1
              ELSE 0
            END
          )::bigint AS count_delta
        FROM ride_points rp
        JOIN rides r ON r.ride_uuid = rp.ride_uuid
        JOIN users u ON u.id = r.user_id
        WHERE r.user_id = $1
          AND (
            r.pocket_mode = FALSE
            OR (r.pocket_mode = TRUE AND u.pocket_confidence >= ${CONFIDENCE_FLOOR})
          )
        GROUP BY ix, iy
      )
    `;

    if (body.shareToPublicMap) {
      // Opting in: aggregate the user's eligible ride_points into
      // bump_cells. Pocket-mode rides contribute when calibration is
      // active; mounted-mode rides always contribute (raw).
      await client.query(
        `${eligibleCte}
         INSERT INTO bump_cells (ix, iy, sum, count)
           SELECT ix, iy, sum_delta, count_delta FROM user_cells
           WHERE count_delta > 0
         ON CONFLICT (ix, iy) DO UPDATE
           SET sum   = bump_cells.sum   + EXCLUDED.sum,
               count = bump_cells.count + EXCLUDED.count`,
        [userId],
      );
    } else {
      // Opting out: subtract the user's eligible contributions. Same
      // CTE — whatever we'd have added on opt-in, we subtract on
      // opt-out, keeping the invariant tight.
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
    }

    await client.query('COMMIT');
    return NextResponse.json({
      shareToPublicMap: body.shareToPublicMap,
      changed: true,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('sharing toggle failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  } finally {
    client.release();
  }
}
