import { z } from 'zod';

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
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3] as const;

const finite = z.number().refine(Number.isFinite, { message: 'must be finite' });

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
});

export type RidePayload = z.infer<typeof rideSchema>;
export type RidePointPayload = z.infer<typeof ridePointSchema>;
export type BrakeEventPayload = z.infer<typeof brakeEventSchema>;
