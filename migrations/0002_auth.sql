-- Phase 2: user accounts. Adds Auth.js (Drizzle adapter) tables, fleshes
-- out `users`, and tightens `rides.user_id` to NOT NULL now that every
-- new ride is scoped to a signed-in user.

-- Pre-auth Phase 1 sync data was anonymous; wipe it before tightening the FK.
-- The deploy hasn't shipped, so this only affects local dev DBs.
DELETE FROM rides WHERE user_id IS NULL;
TRUNCATE bump_cells;

ALTER TABLE rides ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN email_verified TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN image TEXT;

-- Auth.js adapter tables. Names and shapes follow @auth/drizzle-adapter's
-- expected schema (snake_case OAuth fields per the spec, camelCase elsewhere
-- on the JS side via the schema mapping in src/db/schema.ts).

CREATE TABLE accounts (
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                 TEXT NOT NULL,
    provider             TEXT NOT NULL,
    provider_account_id  TEXT NOT NULL,
    refresh_token        TEXT,
    access_token         TEXT,
    expires_at           INTEGER,
    token_type           TEXT,
    scope                TEXT,
    id_token             TEXT,
    session_state        TEXT,
    PRIMARY KEY (provider, provider_account_id)
);

CREATE INDEX accounts_user_id_idx ON accounts (user_id);

CREATE TABLE sessions (
    session_token TEXT PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires       TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE verification_tokens (
    identifier TEXT NOT NULL,
    token      TEXT NOT NULL,
    expires    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);
