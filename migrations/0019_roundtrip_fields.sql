-- Round-trip storage for three additive iOS wire fields we previously
-- dropped at the Zod boundary (z.object strips unknown keys), breaking
-- SCHEMA.md's upload -> restore contract for them:
--
--   - Ride.healthKitWorkoutUUID (iOS v1.5): the device-local HKWorkout
--     UUID written when the ride was exported to Apple Health. Opaque
--     by contract ("round-trip it on storage but do not interpret") —
--     stored as TEXT rather than UUID so Postgres never canonicalises
--     it and the client gets back its exact bytes (iOS uuidString is
--     uppercase; the UUID type would re-emit lowercase).
--   - BrakeEvent.category (iOS v1.7): safety | other | error | unknown.
--   - CloseCall.category (iOS v1.7): vehicle | bike | pedestrian.
--
-- The category columns are TEXT without a CHECK against today's value
-- sets on purpose: SCHEMA.md calls "adding a new enum case" a
-- non-breaking change with no schemaVersion bump, so the server must
-- keep accepting (and round-tripping) cases newer clients send. Only
-- the length is capped — mirror of the Zod bound, so an abusive
-- client can't stuff megabytes into a tag.
--
-- All three are nullable. NULL = the client omitted the field (ride
-- never exported to Health / legacy uncategorised event); the export
-- path omits the key again on the way out.

ALTER TABLE rides
  ADD COLUMN healthkit_workout_uuid TEXT;

ALTER TABLE brake_events
  ADD COLUMN category TEXT,
  ADD CONSTRAINT brake_events_category_len
    CHECK (char_length(category) <= 32);

ALTER TABLE close_call_events
  ADD COLUMN category TEXT,
  ADD CONSTRAINT close_call_events_category_len
    CHECK (char_length(category) <= 32);
