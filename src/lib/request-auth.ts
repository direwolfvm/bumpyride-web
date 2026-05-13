import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { lookupTokenUser, parseBearer } from '@/lib/tokens';

/**
 * Identify the requesting user via either a Bearer API token (iOS) or a
 * web session cookie. Returns the user id, or null if neither is present
 * or valid. Bearer takes priority because it's cheaper than the Auth.js
 * session decode and lets a Bearer-authed caller skip cookie handling.
 */
export async function getRequestUserId(
  req: NextRequest,
): Promise<string | null> {
  const bearer = parseBearer(req.headers.get('authorization'));
  if (bearer) {
    const lookup = await lookupTokenUser(bearer);
    return lookup?.userId ?? null;
  }
  const session = await auth();
  return session?.user?.id ?? null;
}
