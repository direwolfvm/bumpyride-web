-- Fixed-window counters for sign-in and password-reset attempts.
--
-- Cloud Run runs several instances, so an in-memory counter would let an
-- attacker spread guesses across them. Keys are SHA-256 hashes of
-- scope + identifier + window, so no login name or IP is stored here.
-- Rows are only useful until expires_at; the limiter deletes expired rows
-- opportunistically.

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_expires_at_idx
  ON auth_rate_limits (expires_at);
