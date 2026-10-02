-- Sign-in identifier may be a username instead of an email address.
--
-- BumpyRide never sends email: there is no mail library in the codebase,
-- and password reset is proved with a recovery code or a TOTP code (see
-- /api/auth/reset), not a reset link. An email address was therefore
-- being collected only to act as a login name, so riders who would
-- rather not hand one over now don't have to.
--
-- Two columns rather than one relaxed column, because the distinction
-- carries security weight:
--
--   * Google sign-in uses allowDangerousEmailAccountLinking, which links
--     an incoming Google identity to an existing row BY EMAIL. Keeping
--     usernames in their own column — and forbidding "@" in them —
--     means a username can never be email-shaped, so it can never be
--     matched by that linking path. A username-only account is
--     unreachable from OAuth by construction.
--   * Code that genuinely means "an address you could write to" keeps a
--     column that only ever holds addresses.
--
-- Existing rows are untouched: email stays populated, username null.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

-- Case-insensitive uniqueness, matching how sign-in normalises input.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
  ON users (lower(username));

-- Email is now optional, but an account must stay reachable by exactly
-- one of the two.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_identifier_present;
ALTER TABLE users ADD CONSTRAINT users_identifier_present
  CHECK (email IS NOT NULL OR username IS NOT NULL);
