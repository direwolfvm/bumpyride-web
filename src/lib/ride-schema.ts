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
// See bumpyride/docs/SCHEMA.md for the v1/v2 comparison.
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

const finite = z.number().refine(Number.isFinite, { message: 'must be finite' });

export const ridePointSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).pipe(finite),
  longitude: z.number().min(-180).max(180).pipe(finite),
  speed: z.number().min(0).pipe(finite),
  bumpiness: z.number().min(0).pipe(finite),
  accelWindow: z.array(finite),
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
});

export type RidePayload = z.infer<typeof rideSchema>;
export type RidePointPayload = z.infer<typeof ridePointSchema>;
