import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { encodeBase32, generateSecret, provisioningUri } from '@/lib/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Begin TOTP setup. Generates a fresh secret, stores it, and returns the
// otpauth:// provisioning URI plus a PNG data URL ready to drop into an
// <img>. `totp_enabled` stays false until the user verifies their first
// code at /api/me/totp/enable — until then they can re-run setup any
// number of times without locking themselves out.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const me = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { email: true },
  });
  if (!me) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const secret = generateSecret();
  await db
    .update(users)
    .set({ totpSecret: secret, totpEnabled: false })
    .where(eq(users.id, session.user.id));

  const uri = provisioningUri(secret, me.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 256 });

  return NextResponse.json({
    // The base32 secret is also returned so a user can manually type it
    // into an authenticator that won't scan QR.
    secret: encodeBase32(secret),
    provisioningUri: uri,
    qrDataUrl,
  });
}
