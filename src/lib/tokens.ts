import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { pool } from '@/db';
import { apiTokens } from '@/db/schema';

// iOS sync tokens. Format: `br_` + base64url of 32 random bytes (~43 chars
// of payload, plus prefix). The prefix is purely cosmetic so a user pasting
// the token recognises it. Only the sha256 hash is stored — the raw token
// is shown once at creation and never retrievable afterwards.

const TOKEN_PREFIX = 'br_';
const TOKEN_BYTES = 32;

export function generateApiToken(): { token: string; tokenHash: string } {
  const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashApiToken(token) };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Look up the user that owns the given bearer token, and stamp `last_used_at`.
 * Returns null if the token is unknown.
 *
 * Uses the raw `pool` rather than the drizzle proxy because it's on the hot
 * path of every ride sync.
 */
export async function lookupTokenUser(token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashApiToken(token);
  const res = await pool.query<{ user_id: string }>(
    `UPDATE api_tokens
        SET last_used_at = now()
      WHERE token_hash = $1
      RETURNING user_id`,
    [hash],
  );
  return res.rows[0]?.user_id ?? null;
}

export function parseBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization);
  return m ? m[1].trim() : null;
}

// Convenience re-export for the management UI.
export { apiTokens, eq };
