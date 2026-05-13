# bumpyride-web

Companion web app for the [BumpyRide iOS app](https://github.com/jeccles-pif/bumpy-ride).

Two feature sets:

1. **Authenticated mirror of the iOS app** — sign in, see your rides, view routes and a per-user bump map. No recording. Phase 2+.
2. **Public aggregated bump map** — global heat-map of average bumpiness per 20 ft cell, aggregated across all users. No routes, no timestamps, no per-user attribution. Phase 4.

Synchronisation with the iOS app is over a REST API; the on-disk JSON format the iOS app writes (see [`bumpy-ride/BumpyRide/docs/SCHEMA.md`](../../bumpy-ride/BumpyRide/docs/SCHEMA.md)) is also the wire format here.

## Status — Phase 1

Scaffolding only. What works today:

- `GET /api/health` — liveness + DB ping
- `POST /api/sync/ride` — accepts one schema-compliant ride, upserts by `Ride.id`, incrementally updates the global `bump_cells` aggregate. **No auth yet** — the endpoint is open in this phase.

Phase 2 will add auth (Auth.js with email/password + Google, plus per-user API tokens for the iOS app). Phase 3 the web UI. Phase 4 the public bump-map tile renderer.

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| DB | Postgres 16 (Cloud SQL in production, container locally) |
| Query layer | Drizzle ORM + `pg` |
| Validation | Zod |
| Deploy | Docker image → Cloud Run (`bumpyride-web` service) on push to `main` |

## Local development

Requires Docker.

```sh
docker compose up --build
```

Brings up Postgres, runs migrations, and serves the app on http://localhost:8080.

To run the Next.js dev server against a containerised Postgres:

```sh
docker compose up -d postgres
cp .env.example .env
npm install
node scripts/migrate.mjs
npm run dev
```

## Project layout

```
bumpyride-web/
├── Dockerfile
├── docker-compose.yml
├── next.config.mjs
├── package.json
├── tsconfig.json
├── migrations/
│   └── 0001_init.sql          # schema; applied by scripts/migrate.mjs
├── scripts/
│   └── migrate.mjs            # dep-free SQL migration runner
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   └── api/
    │       ├── health/route.ts
    │       └── sync/ride/route.ts
    ├── db/
    │   ├── index.ts           # pg Pool + drizzle wrapper
    │   └── schema.ts          # drizzle table definitions
    └── lib/
        ├── ride-schema.ts     # zod validator matching SCHEMA.md
        └── bump-grid.ts       # port of the iOS BumpGrid cell math
```

## API

### `POST /api/sync/ride`

Accepts one `Ride` object (see [`SCHEMA.md`](../../bumpy-ride/BumpyRide/docs/SCHEMA.md)). Idempotent by `Ride.id` — re-uploading the same ride replaces its points and reconciles the global bump-cell aggregate.

**Request**

```http
POST /api/sync/ride
Content-Type: application/json

{
  "schemaVersion": 1,
  "id": "55E9B0BB-7CBE-4F23-9E0A-1D2C3F4A5B6C",
  "title": "Ride Apr 23, 3:09 PM",
  "startedAt": "2026-04-23T19:09:00Z",
  "endedAt":   "2026-04-23T19:34:00Z",
  "pocketMode": false,
  "points": [ ... ]
}
```

**Responses**

- `200` `{ id, updated, pointCount, distanceM, avgBumpiness, maxBumpiness }`
- `400` validation failure — body returns the zod `issues` array
- `503` from `/api/health` when the DB is unreachable

`schemaVersion` is checked against a hard allow-list (currently `[1]`) per SCHEMA.md's forward-compat rule.

## Data model

See [`migrations/0001_init.sql`](migrations/0001_init.sql). Key points:

- `rides.ride_uuid` is the iOS `Ride.id` — the upsert / dedup key.
- `ride_points` stores everything from `RidePoint`, including `accel_window` as `real[]`.
- `bump_cells` is the global aggregate (`sum`, `count` per `(ix, iy)`). Indices are anchored to `referenceLatitude = 38.9` so they match the iOS `BumpGrid` exactly.
- `users` and `api_tokens` are present but unused in Phase 1.

`rides.distance_m`, `max_bumpiness`, `avg_bumpiness` are denormalised on write so the rides-list view doesn't need to scan `ride_points`.

## Deploy (Cloud Run + Cloud SQL)

The `bumpyride-web` Cloud Run service already builds from this repo on push to `main`. To finish wiring it up:

1. **Cloud SQL Postgres instance** — provision a Postgres 16 instance in the same region as the Cloud Run service. Note its connection name `PROJECT:REGION:INSTANCE`.
2. **Connect the service to Cloud SQL** — in the Cloud Run service settings, add the Cloud SQL connection. This mounts the Unix socket at `/cloudsql/PROJECT:REGION:INSTANCE`.
3. **Secrets** — store the DB password in Secret Manager and reference it as an env var. Set `DATABASE_URL` on the service in the form:
   ```
   postgres://USER:PASSWORD@/bumpyride?host=/cloudsql/PROJECT:REGION:INSTANCE
   ```
4. **Migrations** — run `node scripts/migrate.mjs` against the Cloud SQL instance before promoting a deploy that introduces a new migration. Easiest path: a one-off Cloud Run Job using the same image, with the same `DATABASE_URL` and Cloud SQL connection, command `node scripts/migrate.mjs`.

Phase 2 will introduce additional env vars (`AUTH_SECRET`, Google OAuth client id/secret) which should also live in Secret Manager.
