-- iOS schema v3: hard-brake events + per-point horizontal accel.
-- See bumpyride/docs/BRAKES_WEB_HANDOFF.md for the iOS-side handoff.
--
-- Ride payloads gain an optional `brakeEvents` array (post-hoc
-- detector output) and an optional `horizontalAccel` per RidePoint
-- (g-units, used by the detector and persisted so future server-side
-- re-detection has the same input data the device used).
--
-- Three states for a ride's brake-event knowledge:
--   brake_events_processed = FALSE -> "not run yet" (legacy/v1/v2, or
--     a v3 upload that omitted brakeEvents — iOS will backfill)
--   brake_events_processed = TRUE, 0 rows -> "ran, found nothing"
--   brake_events_processed = TRUE, N rows -> the events themselves
-- The boolean lets us distinguish "detection still pending" from
-- "confirmed empty" in the UI.

ALTER TABLE ride_points
  ADD COLUMN horizontal_accel DOUBLE PRECISION;

ALTER TABLE rides
  ADD COLUMN brake_events_processed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE brake_events (
  ride_uuid               UUID NOT NULL REFERENCES rides(ride_uuid) ON DELETE CASCADE,
  event_uuid              UUID NOT NULL,
  timestamp               TIMESTAMPTZ NOT NULL,
  latitude                DOUBLE PRECISION NOT NULL,
  longitude               DOUBLE PRECISION NOT NULL,
  peak_deceleration_mps2  DOUBLE PRECISION NOT NULL,
  duration_seconds        DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (ride_uuid, event_uuid)
);

-- For per-ride lookups in chronological order on the ride detail page.
CREATE INDEX brake_events_ride_ts_idx
  ON brake_events (ride_uuid, timestamp);
