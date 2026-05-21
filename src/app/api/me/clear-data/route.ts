import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { clearUserData } from '@/lib/account-deletion';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Clear every ride this user owns. Account stays — sign-in still
// works, calibration resets to defaults.
//
// Accepts session cookie OR bearer API token so the iOS app can call
// this from Settings → Web Account using the same token it uses for
// ride sync. Last-write-wins between iOS and web; idempotent on no
// data.

const schema = z.object({
  // When true AND the user has share_to_public_map = TRUE, the user's
  // rides + per-cell contributor rows are reassigned to a freshly
  // minted anonymized user. Their public-map contributions stay
  // visible but with no remaining link to their account. When false
  // (or when the user wasn't sharing), the rides are cascade-deleted
  // and bumpiness contributions subtracted from the public aggregate.
  keepPublicContributions: z.boolean(),
});

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    const outcome = await clearUserData(userId, {
      keepPublicContributions: body.keepPublicContributions,
    });
    return NextResponse.json({
      ok: true,
      ridesOrphaned: outcome.ridesOrphaned,
      ridesDeleted: outcome.ridesDeleted,
    });
  } catch (err) {
    console.error('clear-data failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
