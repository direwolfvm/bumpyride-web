import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserId } from '@/lib/request-auth';
import { loadRideExport } from '@/lib/ride-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-ride JSON export. The shape matches the iOS-side ride schema
// (bumpyride/docs/SCHEMA.md v3) plus a `derived` block with the
// server-computed stats — so an export is a complete record of the
// ride AND round-trips cleanly through /api/sync/ride if anyone
// wanted to re-ingest it.
//
// The iOS-shape payload itself is also served by /api/sync/ride/[id]
// (without the `derived` block) so iOS's restore flow doesn't need
// to know about the web-only fields.

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ride'
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ride: string }> },
) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { ride: rideUuid } = await params;

  const loaded = await loadRideExport(rideUuid, userId);
  if (!loaded) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const body = { ...loaded.payload, derived: loaded.derived };
  const filename = `ride-${slugify(loaded.payload.title)}-${loaded.payload.id.slice(0, 8)}.json`;

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
