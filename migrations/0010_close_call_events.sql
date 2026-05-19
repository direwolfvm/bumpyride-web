-- iOS schema v3, second-stage rollout: user-tapped close-call events.
-- Same schemaVersion as the brake-event work in 0009 — both fields ride
-- on v3 and both are independently optional.
-- See bumpyride/docs/CLOSE_CALLS_WEB_HANDOFF.md.
--
-- Three states, mirroring how the iOS payload conveys them:
--   close_calls_supported = FALSE -> ride predates the close-call
--     feature (pre-v1.3). The data wasn't capturable; we render a
--     distinct "feature wasn't available" empty state.
--   close_calls_supported = TRUE,  0 rows -> ride was recorded with
--     the feature available but the user didn't tap.
--   close_calls_supported = TRUE,  N rows -> the close calls.
-- The flag stays FALSE until iOS uploads a non-null `closeCallEvents`
-- field on this ride (even `[]` is signal that the recording device
-- could capture them).

ALTER TABLE rides
  ADD COLUMN close_calls_supported BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE close_call_events (
  ride_uuid  UUID NOT NULL REFERENCES rides(ride_uuid) ON DELETE CASCADE,
  event_uuid UUID NOT NULL,
  timestamp  TIMESTAMPTZ NOT NULL,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (ride_uuid, event_uuid)
);

-- For per-ride lookups in chronological order on the ride detail page.
CREATE INDEX close_call_events_ride_ts_idx
  ON close_call_events (ride_uuid, timestamp);
