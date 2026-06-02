import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserId } from '@/lib/request-auth';
import { loadRideExport } from '@/lib/ride-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Single-ride download for iOS v1.5's "Restore my rides" flow. See
// bumpyride/docs/SERVER_RESTORE_WEB_HANDOFF.md for the spec.
//
// Bearer (or session) auth. Returns the iOS-schema ride JSON — same
// shape that POST /api/sync/ride accepts, so an iOS device that
// fetches this and pipes it through its existing decoder gets a
// fully-formed Ride back.
//
// The web-only `derived` block (point_count, distance_m, etc.) is
// NOT included here — see /api/me/rides/[ride]/export for that.
// Keeps this endpoint's response a clean wire-compatible payload.
//
// 404 covers both "ride doesn't exist" and "ride exists but
// belongs to another user" so a probing caller can't enumerate.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { id } = await params;

  const loaded = await loadRideExport(id, userId);
  if (!loaded) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json(loaded.payload, {
    headers: {
      'Cache-Control': 'private, no-store',
    },
  });
}
