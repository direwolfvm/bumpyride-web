# bumpyride-web

Companion web app for the [BumpyRide iOS app](https://github.com/direwolfvm/bumpyride).

Two feature sets:

1. **Authenticated mirror of the iOS app** — sign in, see your rides, view routes and a per-user bump map. No recording. Phase 2+.
2. **Public aggregated bump map** — global heat-map of average bumpiness per 20 ft cell, aggregated across all users. No routes, no timestamps, no per-user attribution. Phase 4.

Synchronisation with the iOS app is over a REST API; the on-disk JSON format the iOS app writes (see the iOS repo's [`docs/SCHEMA.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/SCHEMA.md)) is also the wire format here. Seamless pairing is specified at [`docs/WEB_PAIRING.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/WEB_PAIRING.md) and implemented as `GET /ios-pair` on this side.

## Status — Phase 3

Authenticated web UI is live. What works today:

- **Web**: `/signup`, `/login`, sign-out (Credentials + Google).
- **Rides browser**: `/rides` (paginated list), `/rides/[id]` (route on a MapLibre map with bumpiness-gradient polyline, bumpiness-over-time chart, inline rename).
- **Per-user bump map**: `/bump-map` — server-rendered raster tiles aggregating the user's `ride_points` on demand. Renderer mirrors the iOS `BumpMapTileOverlay` (two-pass purple glow + 20 ft colored cells).
- **iOS tokens**: `/settings/tokens` to issue / list / revoke per-device tokens. Plaintext shown once at creation; only the sha256 is stored.
- **API**: `/api/health`, `/api/me` (Bearer), `/api/sync/ride` (Bearer, user-scoped, 409 on cross-user UUID collision), `/api/tokens` (session), `/api/rides/[id]` (session, PATCH rename), `/api/tiles/user/[z]/[x]/[y]` (session, PNG).

Phase 4 will build the **public aggregated bump-map** — anonymous tile endpoint that reads from the maintained `bump_cells` table (no routes, no timestamps, no PII).

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| DB | Postgres 16 (Cloud SQL in production, container locally) |
| Query layer | Drizzle ORM + `pg` |
| Validation | Zod |
| Auth | Auth.js v5 (Credentials + Google), JWT sessions, `@auth/drizzle-adapter`, `bcryptjs` |
| Maps | MapLibre GL JS (client) + Carto Positron basemap; server-rendered raster tiles via `@napi-rs/canvas` |
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

> **Integrating the iOS app?** See [`docs/IOS_INTEGRATION.md`](docs/IOS_INTEGRATION.md) for the full pairing flow, error semantics, and a reference Swift `SyncClient`. The seamless-pairing contract is at the iOS repo's [`docs/WEB_PAIRING.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/WEB_PAIRING.md).

### `GET /ios-pair`

Seamless pairing target for the iOS app's **Sign in with bumpyride.me** button (driven by `ASWebAuthenticationSession`). Required query params: `callback_scheme` (allow-list: today only `bumpyride`) and `state` (opaque CSRF, round-tripped verbatim). If the user is unauthenticated, 302s to `/login?next=…`. Once authenticated, mints a fresh API token labelled with the pairing timestamp and 302s to `<callback_scheme>://pair?token=<plaintext>&state=<echoed>`. Bad callback scheme or missing state → 400 HTML.

### `GET /api/me`

Identity probe for bearer-authenticated callers (iOS). Returns `{ id, email, name }` on 200, `401` on missing / revoked token.

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

Accepts one `Ride` object (see [`SCHEMA.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/SCHEMA.md)). **Requires** `Authorization: Bearer <token>`. Idempotent by `Ride.id` — re-uploading the same ride replaces its points and reconciles the global bump-cell aggregate.

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

Continuous deploy on push to `main` is driven by [`cloudbuild.yaml`](cloudbuild.yaml). The pipeline:

1. Build the Docker image, tagged `:$COMMIT_SHA` and `:latest`
2. Push both tags to Artifact Registry (`us-east4-docker.pkg.dev/bumpyride/bumpyride-web/bumpyride-web`)
3. Point the `bumpyride-migrate` Cloud Run Job at the new image
4. Execute the job and wait for completion — if migrations fail, the build fails and the new image never takes traffic
5. Deploy the new image to the `bumpyride-web` Cloud Run service

`gcloud run deploy/update` with only `--image` preserves env vars, secret bindings, the runtime service account, and the Cloud SQL connection set on the existing revision/job, so the pipeline doesn't have to know about any of that config.

### Infrastructure (one-time setup)

The following GCP resources back the deploy. Everything is in project `bumpyride`, region `us-east4`.

| Resource | Name |
|---|---|
| Cloud SQL Postgres 16 | `bumpyride-db` (`db-g1-small`, 10 GB SSD, zonal) |
| Database / SQL user | `bumpyride` / `bumpyride_app` |
| Artifact Registry repo | `bumpyride-web` (Docker) |
| Cloud Run service | `bumpyride-web` |
| Cloud Run Job (migrations) | `bumpyride-migrate` |
| Runtime service account | `bumpyride-run@bumpyride.iam.gserviceaccount.com` |

The runtime SA has `roles/cloudsql.client` and `roles/secretmanager.secretAccessor` (the latter granted at the secret level for each of the four secrets below).

### Secrets

All in Secret Manager, mounted as Cloud Run env vars:

| Env var | Secret name |
|---|---|
| `AUTH_SECRET` | `bumpyride-auth-secret` |
| `DATABASE_URL` | `bumpyride-database-url` (form: `postgres://bumpyride_app:<pw>@/bumpyride?host=/cloudsql/bumpyride:us-east4:bumpyride-db`) |
| `AUTH_GOOGLE_ID` | `bumpyride-google-id` |
| `AUTH_GOOGLE_SECRET` | `bumpyride-google-secret` |
| (plaintext) `AUTH_URL` | env var on the service — set to the canonical public URL so Auth.js builds correct OAuth callback URLs |
| (plaintext) `AUTH_TRUST_HOST=true` | env var on the service |

The DB password lives in `bumpyride-db-password` for reference; the value is also embedded in `DATABASE_URL`.

### OAuth client

Web application OAuth client in [Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials?project=bumpyride) with authorised redirect URIs for both the Cloud Run default URL and the production domain (`bumpyride.me`) so either entrypoint works.

### Running a migration without a deploy

```sh
gcloud run jobs execute bumpyride-migrate --project=bumpyride --region=us-east4 --wait
```

Useful if you've applied a hot-fix migration directly to `migrations/` and need to run it before the next code change ships.
