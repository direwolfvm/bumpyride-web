import { eq, or, sql } from 'drizzle-orm';
import { users } from '@/db/schema';

// Sign-in identifiers. An account is reached by EITHER an email address
// or a username; see migrations/0023 for why they are separate columns.
//
// BumpyRide sends no email at all — password reset is proved with a
// recovery code or a TOTP code — so an address is a login name and
// nothing else, and riders may decline to give one.

// No "@", so a username can never be mistaken for (or collide with) an
// email address. That is what keeps username-only accounts outside the
// Google account-linking path, which matches on email.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const USERNAME_RULES =
  '3–32 characters: letters, numbers, dots, underscores or hyphens.';

export type Identifier =
  | { kind: 'email'; value: string }
  | { kind: 'username'; value: string };

/**
 * Classify what someone typed into the single sign-in field. Anything
 * containing "@" is treated as an email and must be a valid one —
 * otherwise a typo like "jo@" would silently become a username.
 * Returns null when the value is usable as neither.
 */
export function parseIdentifier(raw: string): Identifier | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  if (value.includes('@')) {
    // Deliberately permissive but anchored: one @, something either side,
    // a dot in the domain. Matches what the signup zod schema accepted.
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
    return ok ? { kind: 'email', value } : null;
  }

  return USERNAME_RE.test(value) ? { kind: 'username', value } : null;
}

/** What to show a signed-in rider, and what they type to confirm a deletion. */
export function identifierOf(row: {
  email?: string | null;
  username?: string | null;
}): string {
  return row.username ?? row.email ?? '';
}

/**
 * Drizzle predicate matching a row by either identifier. Usernames are
 * compared case-insensitively against the same lower() expression the
 * unique index uses, so the index is usable for the lookup.
 */
export function whereIdentifier(id: Identifier) {
  return id.kind === 'email'
    ? eq(users.email, id.value)
    : sql`lower(${users.username}) = ${id.value}`;
}

/** Match either column — used where the caller has a raw string. */
export function whereAnyIdentifier(value: string) {
  const lowered = value.trim().toLowerCase();
  return or(
    eq(users.email, lowered),
    sql`lower(${users.username}) = ${lowered}`,
  );
}
