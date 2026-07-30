import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The distinct event kinds this rider has actually logged, with
// counts. Populates the kind picker on the personal /bump-map —
// custom labels are per-rider, so unlike the public map the client
// can't know them from the built-in registry.
//
// Owner-scoped: returns the rider's own labels only, never anyone
// else's. Capped at the per-account distinct-kind ceiling, so the
// result set is inherently small.

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  try {
    const res = await pool.query<{
      kind: string;
      is_custom: boolean;
      n: string;
    }>(
      `SELECT oe.kind, bool_and(oe.is_custom) AS is_custom, count(*)::bigint AS n
         FROM other_events oe
        WHERE oe.user_id = $1
        GROUP BY oe.kind
        ORDER BY count(*) DESC, oe.kind ASC`,
      [userId],
    );

    return NextResponse.json(
      {
        kinds: res.rows.map((r) => ({
          kind: r.kind,
          isCustom: r.is_custom,
          count: Number(r.n),
        })),
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (err) {
    console.error('user other-event kinds query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
