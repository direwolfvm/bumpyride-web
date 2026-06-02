import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { getRequestUserId } from '@/lib/request-auth';
import { estimateRideSizeBytes } from '@/lib/ride-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Paginated list of the user's rides. Pairs with /api/sync/ride/[id]
// to enable iOS v1.5's "Restore my rides" flow — see
// bumpyride/docs/SERVER_RESTORE_WEB_HANDOFF.md.
//
// Cursor-based pagination over (started_at DESC, ride_uuid DESC),
// not offset-based, so concurrent writes (a new sync mid-restore)
// don't shift the listing. The cursor is opaque-base64 from the
// caller's point of view; we encode (started_at iso, ride_uuid)
// inside it for the next-page WHERE.
//
// Bearer or session auth, same pattern as /api/me/sharing.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type CursorPayload = {
  s: string; // started_at ISO
  i: string; // ride_uuid
};

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const j = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof j?.s !== 'string' || typeof j?.i !== 'string') return null;
    return { s: j.s, i: j.i };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.parseInt(rawLimit ?? '', 10) || DEFAULT_LIMIT),
  );
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) {
    return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
  }

  // Tuple comparison gives a strict less-than over the composite
  // sort key. Postgres's row-value comparison handles it natively
  // and uses the rides_user_id_idx (user_id, started_at DESC) for
  // the seek.
  try {
    const rows = cursor
      ? await pool.query<{
          ride_uuid: string;
          title: string;
          started_at: Date;
          ended_at: Date;
          point_count: number;
        }>(
          `SELECT ride_uuid, title, started_at, ended_at, point_count
             FROM rides
            WHERE user_id = $1
              AND (started_at, ride_uuid) < ($2::timestamptz, $3::uuid)
            ORDER BY started_at DESC, ride_uuid DESC
            LIMIT $4`,
          [userId, cursor.s, cursor.i, limit + 1],
        )
      : await pool.query<{
          ride_uuid: string;
          title: string;
          started_at: Date;
          ended_at: Date;
          point_count: number;
        }>(
          `SELECT ride_uuid, title, started_at, ended_at, point_count
             FROM rides
            WHERE user_id = $1
            ORDER BY started_at DESC, ride_uuid DESC
            LIMIT $2`,
          [userId, limit + 1],
        );

    // Use the (limit + 1) sentinel trick: ask for one more than the
    // requested page size, and if we got it, peel it off as the cursor
    // anchor for the next page. Avoids a second "is there more?" query.
    const hasMore = rows.rows.length > limit;
    const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const nextCursor = hasMore
      ? encodeCursor({
          s: page[page.length - 1].started_at.toISOString(),
          i: page[page.length - 1].ride_uuid,
        })
      : null;

    const totalRes = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM rides WHERE user_id = $1',
      [userId],
    );
    const totalCount = Number(totalRes.rows[0]?.n ?? 0);

    return NextResponse.json(
      {
        rides: page.map((r) => ({
          id: r.ride_uuid,
          title: r.title,
          startedAt: r.started_at.toISOString(),
          endedAt: r.ended_at.toISOString(),
          pointCount: Number(r.point_count),
          sizeBytes: estimateRideSizeBytes({ pointCount: Number(r.point_count) }),
        })),
        nextCursor,
        totalCount,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error('sync/rides list failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
