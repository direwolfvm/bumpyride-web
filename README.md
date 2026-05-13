# bumpyride-web

Companion web app for the [BumpyRide iOS app](https://github.com/jeccles-pif/bumpy-ride).

Two feature sets:

1. **Authenticated mirror of the iOS app** — sign in, see your rides, view routes and a per-user bump map. No recording. Phase 2+.
2. **Public aggregated bump map** — global heat-map of average bumpiness per 20 ft cell, aggregated across all users. No routes, no timestamps, no per-user attribution. Phase 4.

Synchronisation with the iOS app is over a REST API; the on-disk JSON format the iOS app writes (see [`bumpy-ride/BumpyRide/docs/SCHEMA.md`](../../bumpy-ride/BumpyRide/docs/SCHEMA.md)) is also the wire format here.

## Status — Phase 2

Auth + iOS sync tokens. What works today:

- **Web**: `/signup`, `/login`, sign-out. Credentials (email + bcrypt password) and Google OAuth.
- **iOS tokens**: `/settings/tokens` to issue / list / revoke per-device tokens. Plaintext shown once at creation; only the sha256 is stored.
- **`GET /api/health`** — liveness + DB ping.
- **`POST /api/sync/ride`** — now requires `Authorization: Bearer <token>`. Rides scoped to the token's user. A ride UUID owned by a different user returns 409.

Phase 3 will build the web UI for browsing rides and viewing routes / per-user bump map. Phase 4 the public aggregated bump-map tile renderer.

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| DB | Postgres 16 (Cloud SQL in production, container locally) |
| Query layer | Drizzle ORM + `pg` |
| Validation | Zod |
| Auth | Auth.js v5 (Credentials + Google), JWT sessions, `@auth/drizzle-adapter`, `bcryptjs` |
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

### `POST /api/auth/signup`

Email + password registration. Returns `{ id, email }` on success, `409` if the email is taken, `400` with zod issues otherwise.

### Auth.js routes — `/api/auth/*`

Standard Auth.js v5 handler. Useful endpoints:

- `GET /api/auth/csrf` — CSRF token (cookie + JSON)
- `POST /api/auth/callback/credentials` — sign in with email + password (form-encoded, requires `csrfToken`)
- `GET /api/auth/signin/google` — start Google OAuth (only if `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are set)
- `POST /api/auth/signout` — clear session

### `/api/tokens` — iOS sync token management (session-authed)

- `GET` → `{ tokens: [{ id, label, createdAt, lastUsedAt }] }`
- `POST` `{ label }` → `{ id, label, createdAt, token }` — `token` is the **plaintext** shown exactly once
- `DELETE` `?id=<uuid>` → `{ id }`

Tokens are `br_` + 32 random bytes (base64url). Only the sha256 is stored. Use them as `Authorization: Bearer <token>` on `/api/sync/ride`.

### `POST /api/sync/ride`

Accepts one `Ride` object (see [`SCHEMA.md`](../../bumpy-ride/BumpyRide/docs/SCHEMA.md)). **Requires** `Authorization: Bearer <token>`. Idempotent by `Ride.id` — re-uploading the same ride replaces its points and reconciles the global bump-cell aggregate.

**Request**

```http
POST /api/sync/ride
Authorization: Bearer br_...
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
- `401` missing or invalid bearer token
- `409` ride UUID already owned by a different user
- `503` from `/api/health` when the DB is unreachable

`schemaVersion` is checked against a hard allow-list (currently `[1]`) per SCHEMA.md's forward-compat rule.

## Data model

See [`migrations/0001_init.sql`](migrations/0001_init.sql) and [`migrations/0002_auth.sql`](migrations/0002_auth.sql). Key points:

- `rides.ride_uuid` is the iOS `Ride.id` — the upsert / dedup key. `rides.user_id` is `NOT NULL`.
- `ride_points` stores everything from `RidePoint`, including `accel_window` as `real[]`.
- `bump_cells` is the global aggregate (`sum`, `count` per `(ix, iy)`). Indices are anchored to `referenceLatitude = 38.9` so they match the iOS `BumpGrid` exactly.
- `users`, `accounts`, `sessions`, `verification_tokens` are the Auth.js Drizzle-adapter tables. `users.password_hash` is bcrypt; OAuth-only users have it `NULL`.
- `api_tokens.token_hash` is sha256 hex of the plaintext.

`rides.distance_m`, `max_bumpiness`, `avg_bumpiness` are denormalised on write so the rides-list view doesn't need to scan `ride_points`.

## Deploy (Cloud Run + Cloud SQL)

The `bumpyride-web` Cloud Run service already builds from this repo on push to `main`. To finish wiring it up:

1. **Cloud SQL Postgres instance** — provision a Postgres 16 instance in the same region as the Cloud Run service. Note its connection name `PROJECT:REGION:INSTANCE`.
2. **Connect the service to Cloud SQL** — in the Cloud Run service settings, add the Cloud SQL connection. This mounts the Unix socket at `/cloudsql/PROJECT:REGION:INSTANCE`.
3. **Secrets** — store these in Secret Manager and reference them as env vars on the Cloud Run service:
   - `DATABASE_URL` — `postgres://USER:PASSWORD@/bumpyride?host=/cloudsql/PROJECT:REGION:INSTANCE`
   - `AUTH_SECRET` — `openssl rand -base64 32`
   - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — OAuth client credentials from [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials). Create a **Web application** OAuth client and add `<service-url>/api/auth/callback/google` as an authorised redirect URI.
4. **Non-secret env** on the service:
   - `AUTH_URL` — the public URL of the service (e.g. `https://bumpyride-web-xxx.run.app`). Auth.js uses this to build OAuth callback URLs.
   - `AUTH_TRUST_HOST=true` — required when running behind Cloud Run's proxy.
5. **Migrations** — run `node scripts/migrate.mjs` against the Cloud SQL instance before promoting a deploy that introduces a new migration. Easiest path: a one-off Cloud Run Job using the same image, with the same `DATABASE_URL` and Cloud SQL connection, command `node scripts/migrate.mjs`.
