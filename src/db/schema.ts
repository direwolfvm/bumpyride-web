import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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
  // Per-rider pocket-mode calibration. iOS computes the gain locally
  // (median of mountedAvg/pocketAvg across overlapping cells, clamped to
  // [0.5, 5.0]) and PUTs it to /api/me/calibration. We apply the gain to
  // a pocket-mode sample's bumpiness during aggregation when
  // `pocketConfidence >= 3`. See bumpyride/docs/CALIBRATION.md.
  pocketGain: doublePrecision('pocket_gain').notNull().default(1.0),
  pocketConfidence: integer('pocket_confidence').notNull().default(0),
  pocketCalibrationAt: timestamp('pocket_calibration_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rideUuid, t.idx] }),
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
