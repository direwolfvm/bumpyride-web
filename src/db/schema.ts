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
  // Marks a user row as an orphan that exists only to hold public-map
  // contributions detached from a real account. Set when a user runs
  // clear-data or delete-account with `keepPublicContributions: true`;
  // the original account row is then either reset (clear-data) or
  // deleted (delete-account), and this fresh anonymized row inherits
  // the rides + bump_cell_contributors. Auth layer rejects sign-in
  // attempts for any row where this is non-null.
  anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
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
    // SHA-256 of the raw JSON request body at upload time. Drives
    // the v1.7 H5 sync-checksum optimisation: iOS can ask
    // /api/sync/ride/check whether the server already has the ride
    // byte-for-byte and skip the upload if so. Nullable for rides
    // that pre-date this column.
    contentHash: text('content_hash'),
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
    // FALSE until iOS has uploaded a (possibly empty) otherEvents
    // array (iOS v2.0). Same three-state semantics as closeCalls.
    otherEventsSupported: boolean('other_events_supported').notNull().default(false),
    // Device-local HKWorkout UUID (iOS v1.5) — set when the ride was
    // exported to Apple Health on the uploading device. Opaque
    // round-trip-only value; TEXT (not uuid) so the client's exact
    // string, case included, comes back on restore. NULL = field
    // omitted at upload.
    healthkitWorkoutUuid: text('healthkit_workout_uuid'),
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
    // iOS v1.7 user classification (safety/other/error/unknown today;
    // an open set — new cases arrive without a schemaVersion bump).
    // Round-trip only; NULL = legacy or never categorised.
    category: text('category'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rideUuid, t.eventUuid] }),
    rideTsIdx: index('brake_events_ride_ts_idx').on(t.rideUuid, t.timestamp),
  }),
);

// User-initiated close-call markers. iOS users tap "Log Close Call"
// during recording; the snapshot is position + time plus (since iOS
// v1.7) an optional category tag picked in a post-tap modal. No
// severity or notes — anything richer was hostile to one-handed
// in-ride interaction. Same key shape as brake_events so the
// ride-detail page and any future aggregate joins can reuse the
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
    // iOS v1.7 user classification (vehicle/bike/pedestrian today; an
    // open set — new cases arrive without a schemaVersion bump).
    // Round-trip only; NULL = pre-v1.7 close call.
    category: text('category'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rideUuid, t.eventUuid] }),
    rideTsIdx: index('close_call_events_ride_ts_idx').on(t.rideUuid, t.timestamp),
  }),
);

// iOS v2.0 "other events" — rider-logged point events beyond close
// calls (Blocked Lane + rider-defined custom kinds). Privacy split:
//   isCustom            — the client's wire value, stored verbatim so
//                         upload → restore round-trips untouched.
//   isPublicEligible    — server-computed at ingest (built-in registry
//                         membership ∧ NOT isCustom). The ONLY flag
//                         public / cross-account surfaces may filter
//                         on; registry skew degrades toward privacy.
//   userId              — denormalized from rides for the privacy
//                         filter. Deleted (not transferred) when
//                         rides are orphaned to an anonymized user.
// See bumpy-ride/docs/OTHER_EVENTS_WEB_HANDOFF.md.
export const otherEvents = pgTable(
  'other_events',
  {
    rideUuid: uuid('ride_uuid')
      .notNull()
      .references(() => rides.rideUuid, { onDelete: 'cascade' }),
    eventUuid: uuid('event_uuid').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    kind: text('kind').notNull(),
    isCustom: boolean('is_custom').notNull(),
    isPublicEligible: boolean('is_public_eligible').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rideUuid, t.eventUuid] }),
    rideTsIdx: index('other_events_ride_ts_idx').on(t.rideUuid, t.timestamp),
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

// Per (ride, cell) cell-discovery scoring rows. One row per cell a
// ride contributed bumpiness to (gated by sharing-on + mounted-or-
// legacy). Each row holds the awarded tier (10 = first ever to the
// cell, 5 = first by this user but not globally first, 1 = repeat
// visit). Re-uploading a ride wipes its rows and recomputes against
// the rest of the world; sharing-off wipes all of the user's rows.
export const scoreEvents = pgTable(
  'score_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rideUuid: uuid('ride_uuid')
      .notNull()
      .references(() => rides.rideUuid, { onDelete: 'cascade' }),
    ix: integer('ix').notNull(),
    iy: integer('iy').notNull(),
    points: integer('points').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rideCellUq: uniqueIndex('score_events_ride_uuid_ix_iy_key').on(
      t.rideUuid,
      t.ix,
      t.iy,
    ),
    cellIdx: index('score_events_cell_idx').on(t.ix, t.iy),
    userCellIdx: index('score_events_user_cell_idx').on(t.userId, t.ix, t.iy),
  }),
);

// Cached per-user totals so the score page + iOS GET /api/me/score
// don't aggregate score_events on every read. Updated incrementally
// inside the ride sync + sharing toggle transactions.
export const userScores = pgTable('user_scores', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  totalPoints: bigint('total_points', { mode: 'number' }).notNull().default(0),
  firstEverCount: integer('first_ever_count').notNull().default(0),
  firstUserCount: integer('first_user_count').notNull().default(0),
  // Repeats where the cell's most recent prior value — from ANY
  // user — was more than STALE_REFRESH_DAYS older than the ride
  // (see src/lib/scoring.ts). 3 pts each.
  staleRefreshCount: integer('stale_refresh_count').notNull().default(0),
  repeatCount: integer('repeat_count').notNull().default(0),
  // Sum of achievement_events.points for the user. Separate from
  // totalPoints (discovery) so both surfaces can be shown; the level
  // ladder runs on the combined total.
  achievementPoints: bigint('achievement_points', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Achievement awards. ride_uuid set = repeatable per-ride award
// (wiped + re-awarded with the ride, like score_events); ride_uuid
// NULL = one-time milestone rung (monotonic, never revoked). Registry
// + thresholds in src/lib/achievements.ts.
export const achievementEvents = pgTable(
  'achievement_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rideUuid: uuid('ride_uuid').references(() => rides.rideUuid, {
      onDelete: 'cascade',
    }),
    achievementId: text('achievement_id').notNull(),
    points: integer('points').notNull(),
    threshold: doublePrecision('threshold').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userCreatedIdx: index('achievement_events_user_created_idx').on(
      t.userId,
      t.createdAt.desc(),
    ),
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
