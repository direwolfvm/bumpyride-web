import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { pool } from '@/db';
import { GAIN_MAX, GAIN_MIN } from '@/lib/calibration';
import { getRequestUserId } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-rider pocket-mode calibration.
//
// Storage: users.{pocket_gain, pocket_confidence, pocket_calibration_at}.
//
// Application: only on the rider's personal map (/api/tiles/user/...).
// Pocket-mode rides never contribute to the public aggregate today, so
// changing a user's calibration has no effect on bump_cells — we just
// update the stored values. The personal-tile SQL reads `pocket_gain`
// and `pocket_confidence` directly, so a PUT is reflected on the next
// tile request.
//
// Both GET and PUT accept either a Bearer API token (iOS) or a web
// session cookie, matching /api/me/sharing.

const finite = z
  .number()
  .refine(Number.isFinite, { message: 'must be finite' });

const putSchema = z.object({
  pocketGain: z.number().min(GAIN_MIN).max(GAIN_MAX).pipe(finite),
  confidence: z.number().int().min(0),
  lastComputedAt: z
    .union([z.string().datetime({ offset: true }), z.null()])
    .optional(),
});

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const res = await pool.query<{
    pocket_gain: number;
    pocket_confidence: number;
    pocket_calibration_at: Date | null;
  }>(
    `SELECT pocket_gain, pocket_confidence, pocket_calibration_at
       FROM users WHERE id = $1`,
    [userId],
  );
  const row = res.rows[0];
  // The user row always exists for a valid token; even so, the spec
  // requires a shape-conformant default if it were ever missing.
  return NextResponse.json({
    pocketGain: row ? Number(row.pocket_gain) : 1.0,
    confidence: row ? Number(row.pocket_confidence) : 0,
    lastComputedAt: row?.pocket_calibration_at?.toISOString() ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid input', issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const newGain = body.pocketGain;
  const newConfidence = body.confidence;
  const newAt = body.lastComputedAt ? new Date(body.lastComputedAt) : null;

  const res = await pool.query<{ id: string }>(
    `UPDATE users
        SET pocket_gain = $2,
            pocket_confidence = $3,
            pocket_calibration_at = $4
      WHERE id = $1
      RETURNING id`,
    [userId, newGain, newConfidence, newAt],
  );
  if (res.rows.length === 0) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  return NextResponse.json({
    pocketGain: newGain,
    confidence: newConfidence,
    lastComputedAt: newAt ? newAt.toISOString() : null,
  });
}
