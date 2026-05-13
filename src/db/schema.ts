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

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
