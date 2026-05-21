-- Account deletion + clear-data primitives.
--
-- Two user-facing operations exposed by /api/me/clear-data and
-- /api/me/delete-account:
--   1. Clear all my data    — drop my rides, keep my account.
--   2. Delete my account    — drop my rides AND my account.
--
-- Both ask, when the user is sharing to the public maps, whether they
-- want to keep their contributions on the public map (decoupled from
-- their identity) or remove them entirely. "Keep" mints a fresh
-- *anonymized* user row, reassigns the rides + per-cell contributor
-- rows to it, and orphans them there. The original user is then either
-- left empty (clear-data) or deleted (delete-account).
--
-- `users.anonymized_at` flags those orphan rows. The auth layer checks
-- this column and refuses to issue any session/token for an anonymized
-- user — they exist to hold data, not to be logged into.

ALTER TABLE users
  ADD COLUMN anonymized_at TIMESTAMPTZ;

-- We use a partial index for the rare query path that needs to find
-- anonymized rows (e.g. ops scripts auditing orphan growth). Cheap.
CREATE INDEX users_anonymized_idx
  ON users (anonymized_at)
  WHERE anonymized_at IS NOT NULL;
