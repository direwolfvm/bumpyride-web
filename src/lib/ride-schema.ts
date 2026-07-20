import { z } from 'zod';
import { OTHER_EVENT_KIND_MAX_CHARS } from '@/lib/other-events';

// Mirrors bumpy-ride/BumpyRide/docs/SCHEMA.md. We accept the exact JSON the
// iOS app writes to disk; this validator is the trust boundary.

// Versions we know how to ingest. SCHEMA.md tells consumers to refuse
// versions they don't understand rather than silently accepting them.
// v1: pre-pocket-detector. `accelWindow` was HPF-filtered for pocket rides;
//     `bumpiness` was computed live at record time.
// v2: iOS now records `accelWindow` raw regardless of mode, and derives
//     `bumpiness` post-hoc based on the pocket tag (HPF'd RMS for pocket,
//     raw RMS for mounted). Wire-format shape is identical; only the
//     `accelWindow` content shifts. Aggregation is unaffected — we read
//     `bumpiness` and apply the rider's calibration gain.
// v3: hard-brake detection ships on iOS v1.3. Ride payload gains an
//     optional `brakeEvents` array, RidePoint gains an optional
//     `horizontalAccel`. Both are backward-compatible — older clients
//     keep sending v2 and we keep accepting them. See
//     bumpyride/docs/BRAKES_WEB_HANDOFF.md.
// See bumpyride/docs/SCHEMA.md for the v1/v2/v3 comparison.
//
// Additive fields ride on v3 without a schemaVersion bump (SCHEMA.md
// "Additive fields since v3"): Ride.healthKitWorkoutUUID (iOS v1.5)
// and BrakeEvent/CloseCall.category (iOS v1.7). All are round-trip
// only — we store and re-emit them, never interpret them.
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3] as const;

const finite = z.number().refine(Number.isFinite, { message: 'must be finite' });

// User-supplied classification tag (BrakeEvent / CloseCall, iOS v1.7).
// Deliberately NOT z.enum of today's cases: SCHEMA.md says new enum
// cases may appear without a schemaVersion bump and consumers must
// tolerate them, so we accept any bounded string and round-trip it
// verbatim. The 32-char cap mirrors the DB CHECK (migration 0019).
const eventCategory = z.string().min(1).max(32);

export const ridePointSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).pipe(finite),
  longitude: z.number().min(-180).max(180).pipe(finite),
  speed: z.number().min(0).pipe(finite),
  bumpiness: z.number().min(0).pipe(finite),
  accelWindow: z.array(finite),
  // v3, g-units. Magnitude of horizontal user acceleration. Optional —
  // older clients don't emit it. We persist it untouched for future
  // server-side brake re-detection.
  horizontalAccel: z.number().pipe(finite).optional(),
});

// v3 hard-brake event detected by iOS post-hoc at ride save time.
// peakDecelerationMPS2 is positive (magnitude). durationSeconds is the
// run length above the detector's threshold. iOS generates `id` so a
// re-uploaded ride keeps the same event identity.
export const brakeEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).pipe(finite),
  longitude: z.number().min(-180).max(180).pipe(finite),
  peakDecelerationMPS2: z.number().min(0).pipe(finite),
  durationSeconds: z.number().min(0).pipe(finite),
  // iOS v1.7: safety | other | error | unknown (open set, see
  // eventCategory). Null/missing on legacy events and on events whose
  // categorization modal timed out untouched.
  category: eventCategory.nullish(),
});

// v3 close-call event. User-initiated (tap "Log Close Call" while
// recording). Minimal by design — no severity or notes; a category
// tag arrived in iOS v1.7. See bumpyride/docs/CLOSE_CALLS_WEB_HANDOFF.md.
export const closeCallEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).pipe(finite),
  longitude: z.number().min(-180).max(180).pipe(finite),
  // iOS v1.7: vehicle | bike | pedestrian (open set, see
  // eventCategory). Null/missing on pre-v1.7 close calls.
  category: eventCategory.nullish(),
});

// iOS v2.0 "other event". User-initiated (tap "Log Event" during
// recording, pick a kind). `kind` is a registry identifier for
// built-ins or the rider's label verbatim for customs; `isCustom` is
// the privacy switch. Additive on schemaVersion 3 — no version bump.
// See bumpy-ride/docs/OTHER_EVENTS_WEB_HANDOFF.md.
export const otherEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).pipe(finite),
  longitude: z.number().min(-180).max(180).pipe(finite),
  kind: z.string().min(1).max(OTHER_EVENT_KIND_MAX_CHARS),
  isCustom: z.boolean(),
});

export const rideSchema = z.object({
  schemaVersion: z
    .number()
    .int()
    .optional()
    .default(1)
    .refine((v) => (SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(v), {
      message: `unsupported schemaVersion; expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
    }),
  id: z.string().uuid(),
  title: z.string(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  pocketMode: z.boolean().nullish(),
  points: z.array(ridePointSchema),
  // v3, optional. Three states:
  //   - field omitted / null  -> iOS detector hasn't run yet on this ride
  //   - []                    -> ran, found no hard brakes (confirmed empty)
  //   - [ ... ]               -> the events themselves
  // Storage mirrors this via rides.brake_events_processed (false vs
  // true) plus the brake_events row count.
  brakeEvents: z.array(brakeEventSchema).nullish(),
  // v3, optional. Three states:
  //   - field omitted / null  -> ride predates close-call feature
  //   - []                    -> feature available, user didn't tap
  //   - [ ... ]               -> the close calls
  // Storage mirrors this via rides.close_calls_supported (false vs
  // true) plus the close_call_events row count. Unlike brake events,
  // iOS does NOT backfill legacy rides — pre-v1.3 rides stay null.
  closeCallEvents: z.array(closeCallEventSchema).nullish(),
  // iOS v2.0, optional. Same three-state semantics as closeCallEvents:
  //   - field omitted / null  -> ride predates the feature
  //   - []                    -> feature available, nothing logged
  //   - [ ... ]               -> the events
  // Storage mirrors this via rides.other_events_supported plus the
  // other_events row count.
  otherEvents: z.array(otherEventSchema).nullish(),
  // iOS v1.5, optional. Device-local UUID of the HKWorkout this ride
  // was exported to in Apple Health. Meaningless to us and to any
  // other device — SCHEMA.md: "round-trip it on storage but do not
  // interpret". Stored as-is (TEXT column) so the exact string,
  // including iOS's uppercase hex, survives upload -> restore.
  healthKitWorkoutUUID: z.string().uuid().nullish(),
});

export type RidePayload = z.infer<typeof rideSchema>;
export type RidePointPayload = z.infer<typeof ridePointSchema>;
export type BrakeEventPayload = z.infer<typeof brakeEventSchema>;
export type CloseCallEventPayload = z.infer<typeof closeCallEventSchema>;
export type OtherEventPayload = z.infer<typeof otherEventSchema>;
