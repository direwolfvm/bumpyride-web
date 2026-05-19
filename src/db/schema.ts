import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Postgres BYTEA exposed to JS as Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
import { sql } from 'drizzle-orm';
import type { AdapterAccountType } from 'next-auth/adapters';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
  passwordHash: text('password_hash'),
  // Off-by-default opt-in to the global aggregated /map. Toggled via
  // /api/me/sharing, which also backfills / subtracts the user's
  // bump_cells contribution to keep the aggregate consistent.
  shareToPublicMap: boolean('share_to_public_map').notNull().default(false),
  // Per-user escape valve for the "wait until 3 distinct users have
  // contributed before publishing a cell" rule. When TRUE, every cell
  // this user contributes to becomes immediately public. Defaults to
  // FALSE for both new and existing opt-ins — the privacy-tighter
  // posture. Toggled via /api/me/sharing alongside shareToPublicMap.
  publicMapEager: boolean('public_map_eager').notNull().default(false),
  // Per-rider pocket-mode calibration. iOS computes the gain locally
  // (median of mountedAvg/pocketAvg across overlapping cells, clamped to
  // [0.5, 5.0]) and PUTs it to /api/me/calibration. We apply the gain to
  // a pocket-mode sample's bumpiness during aggregation when
  // `pocketConfidence >= 3`. See bumpyride/docs/CALIBRATION.md.
  pocketGain: doublePrecision('pocket_gain').notNull().default(1.0),
  pocketConfidence: integer('pocket_confidence').notNull().default(0),
  pocketCalibrationAt: timestamp('pocket_calibration_at', { withTimezone: true }),
  // RFC 6238 TOTP. Raw secret bytes; null when unset. `totp_enabled` lags
  // the secret — it stays false until the user verifies their first code
  // at setup, so an abandoned setup doesn't lock anyone out.
  totpSecret: bytea('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Single-use password-recovery codes. Plaintext shown once at creation;
// only sha256 stored. Regenerating wipes the user's rows and inserts a
// fresh 8.
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => ({
    userCodeUq: uniqueIndex('recovery_codes_user_id_code_hash_key').on(
      t.userId,
      t.codeHash,
    ),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
    userIdx: index('accounts_user_id_idx').on(t.userId),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index('sessions_user_id_idx').on(t.userId),
  }),
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('api_tokens_user_id_idx').on(t.userId),
  }),
);

export const rides = pgTable(
  'rides',
  {
    rideUuid: uuid('ride_uuid').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    pocketMode: boolean('pocket_mode'),
    schemaVersion: integer('schema_version').notNull(),
    pointCount: integer('point_count').notNull(),
    distanceM: doublePrecision('distance_m').notNull(),
    maxBumpiness: doublePrecision('max_bumpiness').notNull(),
    avgBumpiness: doublePrecision('avg_bumpiness').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // FALSE until iOS has uploaded a (possibly empty) brakeEvents
    // array for this ride. Distinguishes "detector hasn't run yet"
    // from "ran and found no hard brakes" in the UI.
    brakeEventsProcessed: boolean('brake_events_processed').notNull().default(false),
    // FALSE until iOS has uploaded a (possibly empty) closeCallEvents
    // array. Distinguishes "ride predates the feature" (pre-v1.3)
    // from "feature available, user didn't tap." iOS doesn't backfill
    // close calls for legacy rides — pre-v1.3 rides stay supported=FALSE
    // forever.
    closeCallsSupported: boolean('close_calls_supported').notNull().default(false),
  },
  (t) => ({
    userIdx: index('rides_user_id_idx').on(t.userId, t.startedAt.desc()),
  }),
);

export const ridePoints = pgTable(
  'ride_points',
  {
    rideUuid: uuid('ride_uuid')
      .notNull()
      .references(() => rides.rideUuid, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    pointUuid: uuid('point_uuid').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    speed: doublePrecision('speed').notNull(),
    bumpiness: doublePrecision('bumpiness').notNull(),
    accelWindow: real('accel_window').array().notNull().default(sql`'{}'::real[]`),
    // Magnitude of user acceleration projected onto the plane
    // perpendicular to gravity, g-units. iOS v1.3+. Stored so a future
    // server-side brake re-detection has the same input the device
    // used. Nullable for older clients and older rides.
    horizontalAccel: doublePrecision('horizontal_accel'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rideUuid, t.idx] }),
  }),
);

// Hard-brake events. Each row is a single iOS-detected braking
// incident keyed by (ride_uuid, event_uuid). The event_uuid comes from
// the iOS app so re-uploads stay idempotent.
export const brakeEvents = pgTable(
  'brake_events',
  {
    rideUuid: uuid('ride_uuid')
      .notNull()
      .references(() => rides.rideUuid, { onDelete: 'cascade' }),
    eventUuid: uuid('event_uuid').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    peakDecelerationMps2: doublePrecision('peak_deceleration_mps2').notNull(),
    durationSeconds: doublePrecision('duration_seconds').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rideUuid, t.eventUuid] }),
    rideTsIdx: index('brake_events_ride_ts_idx').on(t.rideUuid, t.timestamp),
  }),
);

// User-initiated close-call markers. iOS users tap "Log Close Call"
// during recording; the snapshot is just position + time. No severity
// or category fields by design — anything richer was hostile to
// one-handed in-ride interaction. Same key shape as brake_events so
// the ride-detail page and any future aggregate joins can reuse the
// same access patterns.
export const closeCallEvents = pgTable(
  'close_call_events',
  {
    rideUuid: uuid('ride_uuid')
      .notNull()
      .references(() => rides.rideUuid, { onDelete: 'cascade' }),
    eventUuid: uuid('event_uuid').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rideUuid, t.eventUuid] }),
    rideTsIdx: index('close_call_events_ride_ts_idx').on(t.rideUuid, t.timestamp),
  }),
);

export const bumpCells = pgTable(
  'bump_cells',
  {
    ix: integer('ix').notNull(),
    iy: integer('iy').notNull(),
    sum: doublePrecision('sum').notNull(),
    count: bigint('count', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ix, t.iy] }),
  }),
);

// Distinct (cell, user) pairs for cells the user is actively
// contributing to (sharing on, mounted-or-legacy ride). Drives the
// "show this cell once 3+ users contribute" predicate in the public
// tile query plus the eager-publish escape valve. Kept in sync by the
// ride sync route, sharing toggle, and (cascading) users delete.
export const bumpCellContributors = pgTable(
  'bump_cell_contributors',
  {
    ix: integer('ix').notNull(),
    iy: integer('iy').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ix, t.iy, t.userId] }),
    userIdx: index('bump_cell_contributors_user_idx').on(t.userId),
  }),
);
