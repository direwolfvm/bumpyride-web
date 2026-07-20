-- iOS v2.0 "other events" (Ride.otherEvents): rider-logged point
-- events beyond close calls. Two flavors with different privacy:
-- built-in registry kinds (community data, public-map eligible) and
-- rider-defined custom kinds (private to the owning account).
-- See bumpy-ride/docs/OTHER_EVENTS_WEB_HANDOFF.md.
--
-- Three states, mirroring closeCallEvents exactly:
--   other_events_supported = FALSE -> ride predates the feature.
--   other_events_supported = TRUE, 0 rows -> feature available,
--     nothing logged.
--   other_events_supported = TRUE, N rows -> the events.
--
-- Column notes:
--   is_custom           — the CLIENT's wire value, stored verbatim so
--                         upload -> restore round-trips untouched.
--   is_public_eligible  — server-computed at ingest: TRUE only when
--                         is_custom = FALSE AND kind was in the
--                         built-in registry at ingest time. Public
--                         surfaces (future tile layers) must filter
--                         on THIS column, never on is_custom alone —
--                         a client/server registry skew (client
--                         knows a newer built-in kind than we do)
--                         degrades toward privacy instead of
--                         publishing unvetted kinds.
--   user_id             — denormalized from rides for the privacy
--                         filter, per the handoff's storage sketch.

ALTER TABLE rides
  ADD COLUMN other_events_supported BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE other_events (
  ride_uuid          UUID NOT NULL REFERENCES rides(ride_uuid) ON DELETE CASCADE,
  event_uuid         UUID NOT NULL,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp          TIMESTAMPTZ NOT NULL,
  latitude           DOUBLE PRECISION NOT NULL,
  longitude          DOUBLE PRECISION NOT NULL,
  -- iOS caps custom labels at 40 chars; registry ids are short. The
  -- CHECK backstops the Zod validation at the API boundary.
  kind               TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 40),
  is_custom          BOOLEAN NOT NULL,
  is_public_eligible BOOLEAN NOT NULL,
  PRIMARY KEY (ride_uuid, event_uuid)
);

-- Per-ride lookups in chronological order (ride detail page,
-- payload round-trip).
CREATE INDEX other_events_ride_ts_idx
  ON other_events (ride_uuid, timestamp);

-- The 20-distinct-custom-kinds-per-account cap check at ingest.
CREATE INDEX other_events_user_custom_kind_idx
  ON other_events (user_id, kind)
  WHERE is_custom;

-- Tile-layer indexing (lat/lon or cell) deferred until the public
-- layer ships, per the handoff.
