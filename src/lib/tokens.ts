import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db';
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

export type TokenLookup = {
  userId: string;
  shareToPublicMap: boolean;
};

/**
 * Look up the user that owns the given bearer token, stamp `last_used_at`,
 * and return their public-sharing preference (so the sync handler can decide
 * whether to write to `bump_cells` without a second DB round-trip).
 * Returns null if the token is unknown.
 */
export async function lookupTokenUser(token: string): Promise<TokenLookup | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashApiToken(token);
  const res = await pool.query<{ user_id: string; share_to_public_map: boolean }>(
    `WITH t AS (
       UPDATE api_tokens SET last_used_at = now()
         WHERE token_hash = $1
       RETURNING user_id
     )
     SELECT t.user_id, u.share_to_public_map
       FROM t JOIN users u ON u.id = t.user_id`,
    [hash],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { userId: row.user_id, shareToPublicMap: row.share_to_public_map };
}

export function parseBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization);
  return m ? m[1].trim() : null;
}

/**
 * Mint a fresh API token for a user. Used both by the `/settings/tokens`
 * management UI and the `/ios-pair` seamless-pairing endpoint — same code
 * path so server-issued tokens are indistinguishable from user-issued ones
 * and revocable from the same UI.
 */
export async function createApiToken(
  userId: string,
  label: string,
): Promise<{ id: string; label: string; createdAt: Date; token: string }> {
  const { token, tokenHash } = generateApiToken();
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, tokenHash, label })
    .returning({
      id: apiTokens.id,
      label: apiTokens.label,
      createdAt: apiTokens.createdAt,
    });
  return { ...row, token };
}

// Convenience re-export for the management UI.
export { apiTokens, eq };
