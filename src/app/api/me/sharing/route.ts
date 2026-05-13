import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { auth } from '@/auth';
import { pool } from '@/db';
import { CELL_LAT_DEG, CELL_LON_DEG } from '@/lib/bump-grid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  shareToPublicMap: z.boolean(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const res = await pool.query<{ share_to_public_map: boolean }>(
    'SELECT share_to_public_map FROM users WHERE id = $1',
    [session.user.id],
  );
  return NextResponse.json({
    shareToPublicMap: res.rows[0]?.share_to_public_map ?? false,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
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
      [session.user.id],
    );
    const wasOptedIn = current.rows[0]?.share_to_public_map ?? false;

    if (wasOptedIn === body.shareToPublicMap) {
      await client.query('COMMIT');
      return NextResponse.json({ shareToPublicMap: wasOptedIn, changed: false });
    }

    await client.query(
      'UPDATE users SET share_to_public_map = $1 WHERE id = $2',
      [body.shareToPublicMap, session.user.id],
    );

    if (body.shareToPublicMap) {
      // Opting in: aggregate the user's existing ride_points into bump_cells.
      await client.query(
        `WITH user_cells AS (
           SELECT
             floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
             floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
             SUM(rp.bumpiness)         AS sum_delta,
             COUNT(*)::bigint           AS count_delta
           FROM ride_points rp
           JOIN rides r ON r.ride_uuid = rp.ride_uuid
           WHERE r.user_id = $1
           GROUP BY ix, iy
         )
         INSERT INTO bump_cells (ix, iy, sum, count)
           SELECT ix, iy, sum_delta, count_delta FROM user_cells
         ON CONFLICT (ix, iy) DO UPDATE
           SET sum   = bump_cells.sum   + EXCLUDED.sum,
               count = bump_cells.count + EXCLUDED.count`,
        [session.user.id],
      );
    } else {
      // Opting out: subtract the user's contributions from bump_cells.
      await client.query(
        `WITH user_cells AS (
           SELECT
             floor(rp.longitude / ${CELL_LON_DEG}::float8)::int AS ix,
             floor(rp.latitude  / ${CELL_LAT_DEG}::float8)::int AS iy,
             SUM(rp.bumpiness)         AS sum_delta,
             COUNT(*)::bigint           AS count_delta
           FROM ride_points rp
           JOIN rides r ON r.ride_uuid = rp.ride_uuid
           WHERE r.user_id = $1
           GROUP BY ix, iy
         )
         UPDATE bump_cells
            SET sum   = bump_cells.sum   - user_cells.sum_delta,
                count = bump_cells.count - user_cells.count_delta
           FROM user_cells
          WHERE bump_cells.ix = user_cells.ix
            AND bump_cells.iy = user_cells.iy`,
        [session.user.id],
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
