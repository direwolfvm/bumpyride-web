import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';
import { backfillUserScores, wipeUserScores } from '@/lib/scoring';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Both methods accept either a web session cookie or a Bearer API token,
// so the iOS app can read + write the user's privacy preferences using
// the same token it uses for ride sync. Last-write-wins between iOS and
// web; the operations are idempotent on state.
//
// Two booleans are exposed:
//   shareToPublicMap — opts the user's eligible (mounted/legacy)
//                      rides into the public aggregate at all.
//   publicMapEager   — when also opted in, the user's cells appear
//                      immediately in /api/tiles/public, bypassing the
//                      "wait until 3 distinct users contribute" rule.
//                      Defaults to FALSE for the safer privacy posture.

const patchSchema = z
  .object({
    shareToPublicMap: z.boolean().optional(),
    publicMapEager: z.boolean().optional(),
  })
  .refine(
    (v) => v.shareToPublicMap !== undefined || v.publicMapEager !== undefined,
    'must supply at least one of shareToPublicMap, publicMapEager',
  );

type SettingsRow = {
  share_to_public_map: boolean;
  public_map_eager: boolean;
};

function payload(row: SettingsRow | undefined) {
  return {
    shareToPublicMap: row?.share_to_public_map ?? false,
    publicMapEager: row?.public_map_eager ?? false,
  };
}

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const res = await pool.query<SettingsRow>(
    'SELECT share_to_public_map, public_map_eager FROM users WHERE id = $1',
    [userId],
  );
  return NextResponse.json(payload(res.rows[0]));
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

  // Backfill / subtract the user's contributions to bump_cells +
  // bump_cell_contributors so the invariants
  //   bump_cells              = SUM of ride_points belonging to opted-in users
  //   bump_cell_contributors  = distinct (cell, user) pairs over the same
  // hold at all times. A user toggling sharing on/off doesn't strand
  // stale data either direction.
  //
  // The CELL_*_DEG constants are JS-side; embed as literals so the query
  // plan stays cacheable and matches the iOS BumpGrid math exactly.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<SettingsRow>(
      'SELECT share_to_public_map, public_map_eager FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const wasShared = current.rows[0]?.share_to_public_map ?? false;
    const wasEager = current.rows[0]?.public_map_eager ?? false;
    const nextShared = body.shareToPublicMap ?? wasShared;
    // Important policy: turning sharing OFF also clears the eager flag.
    // When sharing comes back on later, the user starts fresh in the
    // "wait for 3 users" mode — matching the message in the UI that
    // "opting in defaults to wait for 3 other riders".
    const nextEager = nextShared
      ? (body.publicMapEager ?? wasEager)
      : false;

    if (wasShared === nextShared && wasEager === nextEager) {
      await client.query('COMMIT');
      return NextResponse.json({
        shareToPublicMap: wasShared,
        publicMapEager: wasEager,
        changed: false,
      });
    }

    await client.query(
      `UPDATE users
          SET share_to_public_map = $1,
              public_map_eager    = $2
        WHERE id = $3`,
      [nextShared, nextEager, userId],
    );

    // Aggregate / per-cell contributor maintenance only fires when the
    // share-to-public-map toggle itself flipped; flipping just eager
    // doesn't change what's in bump_cells or bump_cell_contributors,
    // only which cells the public tile route renders.
    if (wasShared !== nextShared) {
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

      if (nextShared) {
        // Opting in: aggregate the user's eligible ride_points into
        // bump_cells and add a contributor row per distinct cell.
        await client.query(
          `${eligibleCte}
           INSERT INTO bump_cells (ix, iy, sum, count)
             SELECT ix, iy, sum_delta, count_delta FROM user_cells
           ON CONFLICT (ix, iy) DO UPDATE
             SET sum   = bump_cells.sum   + EXCLUDED.sum,
                 count = bump_cells.count + EXCLUDED.count`,
          [userId],
        );
        await client.query(
          `${eligibleCte}
           INSERT INTO bump_cell_contributors (ix, iy, user_id)
             SELECT ix, iy, $1 FROM user_cells
           ON CONFLICT DO NOTHING`,
          [userId],
        );
        // Cell-discovery scoring: backfill from every eligible ride
        // chronologically so the tier sequence (10 → 5 → 1) lines up
        // with how the user actually accumulated cells.
        await backfillUserScores(client, userId);
      } else {
        // Opting out: subtract the user's eligible contributions and
        // drop all of their contributor rows. Same CTE — whatever we
        // added on opt-in, we subtract on opt-out.
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
        // Cell-discovery scoring: opting out resets the score to zero
        // and removes the user from the "first ever" calculation for
        // every cell they had. Other users won't get retroactively
        // promoted (deliberate simplification — see scoring.ts).
        await wipeUserScores(client, userId);
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({
      shareToPublicMap: nextShared,
      publicMapEager: nextEager,
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
