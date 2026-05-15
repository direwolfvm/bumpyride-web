-- Phase 8: password recovery via authenticator app (TOTP) and one-time
-- recovery codes. Both are independent reset mechanisms; either can be
-- exchanged for a new password at /forgot.
--
-- TOTP fields live on users; the secret is stored as raw bytes (BYTEA)
-- so we don't have to think about base32 normalisation at rest.
-- `totp_enabled` lags `totp_secret`: setup stores the secret first,
-- and only flips enabled to true once the user successfully enters a
-- code from their authenticator — this prevents lockout if they
-- abandon setup mid-flow.
ALTER TABLE users
    ADD COLUMN totp_secret  BYTEA,
    ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Recovery codes are single-use. The plaintext is shown to the user
-- exactly once at creation; only the sha256 hash is stored. Regenerating
-- the user's set wipes all rows and inserts a fresh 8.
CREATE TABLE recovery_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at     TIMESTAMPTZ,
    UNIQUE (user_id, code_hash)
);

CREATE INDEX recovery_codes_user_unused_idx
    ON recovery_codes (user_id) WHERE used_at IS NULL;
