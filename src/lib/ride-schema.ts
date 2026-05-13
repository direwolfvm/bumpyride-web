import { z } from 'zod';

// Mirrors bumpy-ride/BumpyRide/docs/SCHEMA.md. We accept the exact JSON the
// iOS app writes to disk; this validator is the trust boundary.

// Versions we know how to ingest. SCHEMA.md tells consumers to refuse
// versions they don't understand rather than silently accepting them.
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

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
