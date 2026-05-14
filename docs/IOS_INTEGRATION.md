# BumpyRide iOS ↔ bumpyride-web integration

Audience: engineers on the BumpyRide iOS app adding "sync rides to my web account" support.

This document is the bumpyride-web side of the iOS integration. Companion docs in the iOS repo:

- [`docs/SCHEMA.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/SCHEMA.md) — the `Ride` / `RidePoint` JSON wire format. This web app accepts exactly that shape.
- [`docs/WEB_PAIRING.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/WEB_PAIRING.md) — the contract for the seamless **Sign in with bumpyride.me** flow that `GET /ios-pair` (on this side) targets.

## TL;DR

**Seamless flow (primary path).** Driven by the **Sign in with bumpyride.me** button in iOS Settings → Web Account, fully specified in [`docs/WEB_PAIRING.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/WEB_PAIRING.md):

1. iOS opens `ASWebAuthenticationSession` at `https://bumpyride.me/ios-pair?callback_scheme=bumpyride&state=<random>`.
2. If the user already has a Safari session, the web auto-recognises them. Otherwise they sign in (or sign up) inside the system-managed browser — the page understands a `?next=` round-trip back to `/ios-pair`.
3. The web app mints a fresh API token (label: `iOS — paired <UTC timestamp>`) and 302-redirects to `bumpyride://pair?token=<plaintext>&state=<echoed-state>`.
4. `ASWebAuthenticationSession` captures the callback URL privately — Safari history and other apps never see the token — and hands it to iOS.
5. iOS validates the token by calling `GET /api/me`, stores it in Keychain, and shows "Connected as &lt;email&gt;".
6. From then on, every saved ride is `POST /api/sync/ride` with `Authorization: Bearer <token>`.

**Fallback flow (paste a token).** Used when the seamless flow can't be (older iOS app version, dev's user-agent, manual reconnect after revoke). The user creates a token at `/settings/tokens` and pastes it into iOS. Same Keychain destination, same downstream behavior.

The sync API is idempotent on `Ride.id`, so re-uploads (after a crash, after the user trims an existing ride, after a backfill) are safe.

## Base URL

| Environment | URL |
|---|---|
| Production | `https://bumpyride.me` |
| Direct Cloud Run (pre-DNS / fallback) | `https://bumpyride-web-1020282465439.us-east4.run.app` |

Both serve the same instance. Use a build-flag-selectable constant in the iOS app so QA can switch between them.

## Seamless pairing flow

The web app is the source of truth for accounts. iOS never collects a password.

```
┌──────────┐                              ┌─────────────────────┐
│  iOS UI  │                              │    bumpyride.me     │
└────┬─────┘                              └──────────┬──────────┘
     │ user taps "Sign in with bumpyride.me"        │
     │                                              │
     ├─ opens ASWebAuthenticationSession ──────────►│
     │  GET /ios-pair?callback_scheme=bumpyride&    │
     │      state=<uuid>                            │
     │                                              │
     │  ┌─ if not signed in ─────────────────────┐  │
     │  │ 302 /login?next=/ios-pair?...          │  │
     │  │ user signs in / signs up               │  │
     │  │ 302 back to /ios-pair?...              │  │
     │  └────────────────────────────────────────┘  │
     │                                              │
     │  mints fresh API token                       │
     │◄─ 302 bumpyride://pair?token=…&state=…       │
     │                                              │
     │ ASWebAuthenticationSession captures URL      │
     │ privately, returns it to iOS                 │
     │                                              │
     ├── GET /api/me  Bearer <token> ──────────────►│
     │◄────── 200 { id, email, name } ──────────────┤
     │                                              │
     │ iOS stores token in Keychain                 │
     │ iOS shows "Connected as <email>"             │
```

The full contract for `/ios-pair` lives in [`docs/WEB_PAIRING.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/WEB_PAIRING.md). Key constraints:

- `callback_scheme` is allow-listed server-side (today: `bumpyride` only). Unknown schemes return a 400 HTML page.
- `state` is opaque to the server — it must be reflected back byte-for-byte. iOS uses it to verify the callback matches the request it initiated.
- The plaintext token is fine in the redirect URL because `ASWebAuthenticationSession` captures the callback before Safari history sees it and no other app can claim the `bumpyride` scheme inside the auth session.

### Fallback: paste a token from `/settings/tokens`

When the seamless flow isn't available (older iOS app, dev environment, reconnect after a revoke), the existing paste-a-token UX is unchanged:

1. User signs in at `/login` and creates a token at `/settings/tokens` in a regular browser.
2. The plaintext token is shown **once** at creation — the user copies it.
3. They paste it into the iOS app's manual entry field.
4. iOS validates via `GET /api/me` and stores in Keychain.

Both flows write to the same Keychain slot and produce the same downstream behavior.

## API reference

All endpoints accept and return JSON. `Authorization: Bearer <token>` is required where indicated; tokens look like `br_` + ~43 url-safe characters.

### `GET /api/me`  *(bearer)*

Identity probe. Use this at pairing time to validate the token the user just pasted.

```http
GET /api/me HTTP/1.1
Authorization: Bearer br_qWG1d-lTKwN7wLjOpbDnt84JB92XpIQvdKPDUq_nBtM
```

| Code | Body | Meaning |
|---|---|---|
| 200 | `{ id, email, name }` | Token is valid |
| 401 | `{ error }` | Token missing or revoked |

`name` may be `null` for users who signed up without one.

### `POST /api/sync/ride`  *(bearer)*

Upload one ride. Idempotent on `Ride.id`.

```http
POST /api/sync/ride HTTP/1.1
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

`Ride` follows [`SCHEMA.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/SCHEMA.md) exactly — including the `accelWindow` per-point arrays. Don't strip them on the way out; the web app stores them so playback works in the web UI later.

| Code | Body | iOS action |
|---|---|---|
| 200 | `{ id, updated, pointCount, distanceM, avgBumpiness, maxBumpiness }` | Mark ride as synced |
| 400 | `{ error, issues? }` | Log + skip — payload doesn't match schema (this is a bug in the iOS export path; the user shouldn't see it) |
| 401 | `{ error }` | Token revoked. Wipe Keychain, drop user into the pairing UI |
| 409 | `{ error }` | `ride_uuid` is already owned by a different account. Surface as "this ride was synced from another account" — user probably swapped tokens |
| 503 / 5xx | (any) | Network / server. Retry with backoff (see [Sync strategy](#sync-strategy)) |

Body size note: a ride can be a few MB because of `accelWindow`. The server accepts up to 10 MB; rides larger than that would need a chunking protocol we haven't designed yet.

#### Public-aggregate eligibility

A ride contributes to the public bump map at `/map` iff **both** of these are true:

1. The owning user has `shareToPublicMap = true` (toggled at `/settings/privacy`).
2. The ride's `pocketMode` is **`false`** — that is, the phone was on a mounted, calibrated position.

Pocket-mode rides (`pocketMode: true`) and legacy rides without the field (`pocketMode: null` — recorded before the field existed) are always personal-only; their points stay in `/bump-map` for the rider but never reach `/map`. The framing is "the public map shows calibrated sensor data" — phone-on-body damping would muddy that signal.

Toggling sharing on backfills only mounted-mode rides; toggling off subtracts only mounted-mode contributions (pocket-mode rides were never added). Re-uploading the same `Ride.id` with a changed `pocketMode` flips its eligibility — the server applies the correct delta in a single transaction.

iOS doesn't need to make any decisions here; just send the `pocketMode` value the way you record it, and the web will route the ride correctly.

### `GET /api/me/sharing`  *(bearer or session)*
### `PATCH /api/me/sharing`  *(bearer or session)*

Read and write the user's **public bump map** opt-in. The public aggregated map at `/map` only includes data from users with this flag set to `true`; default is `false`. The setting is a single user-wide boolean (not per-device) — every iOS install paired to the same account sees the same value, and any change from iOS is reflected on the web immediately (and vice versa).

`GET` returns:

```json
{ "shareToPublicMap": false }
```

`PATCH` with body `{ "shareToPublicMap": true }` flips the flag and atomically backfills the user's existing rides into the public aggregate. Body `{ "shareToPublicMap": false }` subtracts them. The response includes a `changed` flag indicating whether the value actually moved:

```json
{ "shareToPublicMap": true, "changed": true }
```

| Code | Body | iOS action |
|---|---|---|
| 200 | `{ shareToPublicMap, changed? }` | Update local toggle state |
| 400 | `{ error, issues? }` | Bug — log + reset toggle |
| 401 | `{ error }` | Token revoked, same handling as `/api/sync/ride` 401 |

**Recommended iOS UX**: on Settings / Privacy screen open, `GET` to refresh the toggle from the server (covers the case where the user toggled it from the web). On toggle, `PATCH` immediately; on failure, revert the toggle and show an error banner. Because the operation is idempotent on state (sending `true` when already `true` is a no-op `{ changed: false }`), retries are safe.

**Backfill cost**: `PATCH true` aggregates the user's entire ride history into the public table in a single transaction. For typical libraries this is milliseconds. iOS should be tolerant of a short delay (≤2 s for very large libraries) and not time out aggressively.

### `POST /api/auth/signup` *(no auth)*

Email + password registration. iOS shouldn't call this directly — drive users through the web signup page so the user creates a token in the same session.

## Sync strategy

Recommended approach for iOS:

1. **On ride save**: enqueue the new ride into a persistent "to-sync" queue (Core Data / SwiftData table flagging the ride as unsynced).
2. **Background drain**: a single serial uploader pulls from the queue. After a successful 200, clear the unsynced flag. On 5xx or network failure, retry with exponential backoff (e.g. 30 s, 2 min, 10 min, hourly).
3. **On app launch / reachable**: re-drain the queue.
4. **On Edit / Trim / Split**: re-enqueue the affected ride(s). Same `Ride.id` ⇒ idempotent upsert.
5. **On Delete locally**: there's no remote delete endpoint yet. Track this as an open item.

### Backfill (first connect)

When a user first pairs an account, queue every existing local ride for upload, oldest first. The server tolerates this; each call is independent.

For very large libraries you may want to throttle to a few rides per minute to be polite — there's no rate limit today but please don't fire 1000 rides in parallel.

### Schema version

The server has a hard allow-list on `schemaVersion`. As of writing it accepts `[1, 2]`. `v2` is the current iOS-side format (raw `accelWindow` with `bumpiness` derived post-hoc — see the iOS-side [`docs/SCHEMA.md`](https://github.com/direwolfvm/bumpyride/blob/main/docs/SCHEMA.md) for the v1/v2 semantic comparison). `v1` is still accepted so older saved rides re-upload cleanly. When iOS bumps to `3`, coordinate the server allow-list update through this repo first; otherwise every upload returns `400`.

## Sample Swift sync client

Reference shape — production code will need proper error mapping, persistence, and concurrency.

```swift
import Foundation

actor SyncClient {
    enum SyncResult {
        case ok
        case unauthorized
        case conflict        // ride owned by another user
        case malformed       // 400 — payload doesn't match schema
        case retryable(Error)
    }

    private let baseURL: URL
    private let tokenProvider: () -> String?
    private let session: URLSession

    init(baseURL: URL, tokenProvider: @escaping () -> String?, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.session = session
    }

    func ping() async -> SyncResult {
        guard let token = tokenProvider() else { return .unauthorized }
        var req = URLRequest(url: baseURL.appendingPathComponent("api/me"))
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return await perform(req)
    }

    func uploadRide(_ ride: Ride) async -> SyncResult {
        guard let token = tokenProvider() else { return .unauthorized }
        var req = URLRequest(url: baseURL.appendingPathComponent("api/sync/ride"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        do {
            req.httpBody = try encoder.encode(ride)
        } catch {
            return .malformed
        }
        return await perform(req)
    }

    private func perform(_ req: URLRequest) async -> SyncResult {
        do {
            let (_, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else { return .retryable(URLError(.badServerResponse)) }
            switch http.statusCode {
            case 200..<300: return .ok
            case 400:       return .malformed
            case 401:       return .unauthorized
            case 409:       return .conflict
            default:        return .retryable(URLError(.cannotConnectToHost))
            }
        } catch {
            return .retryable(error)
        }
    }
}
```

`Ride` is the existing `Codable` type from [`Models.swift`](https://github.com/direwolfvm/bumpyride/blob/main/BumpyRide/Models.swift). Its `CodingKeys` already match the wire format, so re-encoding with an ISO-8601 `JSONEncoder` produces a valid payload.

## Storing the token

Keychain. Specifically:

| Setting | Value |
|---|---|
| Service | `me.bumpyride.web` (or your app's bundle id) |
| Account | the user's email returned by `/api/me`, or a single `"default"` slot if you only support one account |
| Accessibility | `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` |

Never put the token in `UserDefaults` or in `Info.plist`. It grants full sync access to the user's web account.

## Connection-status UX

Recommended Settings screen states:

- **Not connected** — "Connect your web account" button + brief explainer + "Open bumpyride.me" link
- **Connected** — "Connected as <email>" + "Disconnect" button
- **Token invalid** — sticky banner: "Your sync connection is no longer authorised. Reconnect to keep your rides backed up." This shows after any 401 from `/api/sync/ride` or `/api/me`

On "Disconnect" iOS should:
1. Wipe Keychain
2. Mark all rides locally as unsynced (so a future reconnect re-uploads)
3. Tell the user to also revoke the token from `https://bumpyride.me/settings/tokens` if they're moving to a different web account

## Privacy notes

- Only data the user explicitly uploads ever reaches the server.
- The public bump map (Phase 4, not yet built) aggregates `bumpiness` per 20 ft cell across all users with no per-user attribution, no timestamps, no routes — just average bumpiness per cell. Individual rides are never made public.
- Tokens are sha256-hashed on storage; even with full DB read access on the web side, raw tokens cannot be retrieved — only re-issued.

## Future: deep-link pairing

When/if we want a smoother UX:

1. Register a custom URL scheme on the iOS app, e.g. `bumpyride://link`.
2. Add a "Send to iOS" button on `/settings/tokens` that calls `window.location = 'bumpyride://link?token=' + encodeURIComponent(token)`.
3. iOS app handles the URL, extracts the token, validates with `/api/me`, stores in Keychain.

This stays compatible with copy-paste — both flows write the same Keychain slot.

A more secure variant (token never appears in a URL) would be a short-lived "pairing code" the user types from web → iOS. Worth the extra protocol only if we see token leakage in practice.

## Open items

These would make the integration story more complete. Track or file as issues against this repo:

- **Ride delete endpoint** — iOS has no way to tell the server "the user deleted this ride locally; drop it from the web mirror".
- **Ride list endpoint** — iOS could pull rides created on other devices, useful for restoring after reinstall.
- **Server push for trim/split conflicts** — currently the last write wins. If the same ride is edited on both web and iOS, the most recent upload silently overwrites.
- **Pairing-code flow** — see above.

## Contact

Open issues at https://github.com/direwolfvm/bumpyride-web/issues. Reference the iOS commit / build so we can correlate sync failures with code revisions.
