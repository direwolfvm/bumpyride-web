-- Phase 1 schema. Mirrors the iOS Ride / RidePoint wire format
-- documented in bumpy-ride/BumpyRide/docs/SCHEMA.md.

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);

CREATE TABLE rides (
    -- ride_uuid is the iOS-emitted Ride.id; the dedup key for re-uploads.
    ride_uuid       UUID PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ NOT NULL,
    pocket_mode     BOOLEAN,
    schema_version  INT NOT NULL,
    point_count     INT NOT NULL,
    distance_m      DOUBLE PRECISION NOT NULL,
    max_bumpiness   DOUBLE PRECISION NOT NULL,
    avg_bumpiness   DOUBLE PRECISION NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rides_user_id_idx ON rides (user_id, started_at DESC);

CREATE TABLE ride_points (
    ride_uuid    UUID NOT NULL REFERENCES rides(ride_uuid) ON DELETE CASCADE,
    idx          INT  NOT NULL,
    point_uuid   UUID NOT NULL,
    timestamp    TIMESTAMPTZ NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    speed        DOUBLE PRECISION NOT NULL,
    bumpiness    DOUBLE PRECISION NOT NULL,
    accel_window REAL[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (ride_uuid, idx)
);

-- Global aggregated bump grid. Keyed by 20 ft cell indices anchored at
-- referenceLatitude = 38.9 (per BumpGrid.swift). Maintained incrementally
-- on ride upsert/delete.
CREATE TABLE bump_cells (
    ix     INT NOT NULL,
    iy     INT NOT NULL,
    sum    DOUBLE PRECISION NOT NULL,
    count  BIGINT NOT NULL,
    PRIMARY KEY (ix, iy)
);
