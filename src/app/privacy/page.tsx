import type { Metadata } from 'next';
import Link from 'next/link';

// Hard-coded effective date. The user-visible date should not change every
// time we rebuild the site; update it explicitly when the policy itself
// changes. Apple's App Review will check this against the policy's
// actual content.
const EFFECTIVE_DATE = 'May 14, 2026';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How the BumpyRide iOS app and bumpyride.me handle your data: what is collected, what leaves your device, what appears on the public maps (bumpiness, hard brakes, close calls), and how to delete it.',
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-invert mx-auto max-w-3xl">
      <header>
        <h1 className="mt-0 text-3xl font-semibold tracking-tight sm:text-4xl">
          Privacy policy
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Effective {EFFECTIVE_DATE}.
        </p>
        <p className="mt-4 text-text-muted">
          This policy describes how the BumpyRide iOS app and{' '}
          <Link href="/">bumpyride.me</Link> collect, store, and share your
          data. It is written to match what the app actually does — when in
          doubt, this page is the source of truth.
        </p>
      </header>

      <H2>What stays on your iPhone</H2>
      <p>
        By default, every byte BumpyRide records lives only on your device.
        Nothing leaves your phone unless you explicitly pair a bumpyride.me
        account (see the next section).
      </p>
      <p>For each ride you record, the app saves to your device:</p>
      <Ul>
        <li>GPS coordinates (latitude and longitude) sampled every ~3 m of motion.</li>
        <li>
          Accelerometer-derived vibration data — raw vertical-axis samples at
          50 Hz, retained as 5-second windows attached to each saved location
          point. From iOS v1.3 onwards a per-point horizontal-acceleration
          magnitude is also stored, used by the on-device brake detector.
        </li>
        <li>A timestamp for each sample.</li>
        <li>A user-chosen title for the ride.</li>
        <li>
          A binary tag indicating whether the phone was on the rider&apos;s
          body (pocket mode) or on a fixed bike mount.
        </li>
        <li>
          <strong>Hard-brake events</strong> (iOS v1.3+) — id, timestamp,
          location, peak deceleration, and duration for every sustained
          brake the on-device detector finds when the ride saves.
        </li>
        <li>
          <strong>Close-call markers</strong> (iOS v1.3+) — id, timestamp,
          and location for every near-miss you flag during a ride by
          tapping <em>Log Close Call</em>. No severity, category, or
          notes are captured.
        </li>
      </Ul>
      <p>The app also stores a few preferences on the device:</p>
      <Ul>
        <li>Your bumpiness color thresholds.</li>
        <li>Your Bump Map filter selection (All / Mounted / Pocket).</li>
      </Ul>
      <p>
        While a ride is in progress, BumpyRide also writes a crash-safe
        journal at <code>&lt;Documents&gt;/Recording/</code> so a force-quit
        or low-battery shutdown won&apos;t lose your in-progress data. The
        journal is automatically cleared the moment you save or discard the
        ride.
      </p>
      <p>
        Uninstalling the iOS app deletes everything above. There is no
        background cloud backup unless you explicitly enable iCloud backup
        for the app in iOS Settings — and even then, only iCloud has the
        data, not us.
      </p>

      <H2>What we receive when you pair a web account</H2>
      <p>
        Pairing a bumpyride.me account (Settings → Web Account → &ldquo;Sign
        in with bumpyride.me&rdquo;) is the only path by which your data
        reaches our servers. Once paired, the app sends:
      </p>
      <Ul>
        <li>
          <strong>Your email address</strong> — returned by{' '}
          <code>/api/me</code> immediately after pairing so the app can
          display &ldquo;Connected as &lt;email&gt;&rdquo;.
        </li>
        <li>
          <strong>One bearer API token</strong> — stored in your iOS Keychain
          on the device only. It identifies your iPhone to our server when
          uploading rides. You can revoke it at any time from{' '}
          <Link href="/settings/tokens">/settings/tokens</Link>.
        </li>
        <li>
          <strong>Each saved ride</strong> — POSTed to{' '}
          <code>/api/sync/ride</code> and stored server-side. This includes
          everything listed above: GPS, accelerometer windows, timestamps,
          title, pocket-mode tag, plus (from iOS v1.3) per-point
          horizontal-acceleration, the ride&apos;s hard-brake events, and
          any close-call markers you logged. Deleting a close call on iOS
          re-syncs the ride with the marker gone.
        </li>
        <li>
          <strong>Your pocket-mode calibration</strong> — a single per-user
          scalar (<em>pocketGain</em>) plus a confidence integer, sent to{' '}
          <code>/api/me/calibration</code> whenever the iOS-side algorithm
          recomputes it. We use it to scale your pocket-mode samples on your
          personal map only.
        </li>
        <li>
          <strong>Your public-map opt-in</strong> — a single boolean sent to{' '}
          <code>/api/me/sharing</code>. Off by default. Affects only whether
          your data contributes to the public aggregate; never affects your
          private rides view.
        </li>
      </Ul>

      <H2>What appears on the public maps</H2>
      <p>
        Contributing to the{' '}
        <Link href="/map">public maps</Link> is{' '}
        <strong>off by default</strong>. Turn it on at{' '}
        <Link href="/settings/privacy">/settings/privacy</Link>.
      </p>
      <p>If — and only if — you have opted in:</p>
      <Ul>
        <li>
          Your rides contribute to three public aggregates on{' '}
          <Link href="/map">bumpyride.me/map</Link>, accessible from a
          single tab switcher: <strong>Bumpiness</strong> (average road
          roughness per cell), <strong>Hard brakes</strong> (count of
          detected brake events per cell), and <strong>Close calls</strong>{' '}
          (count of rider-tapped close calls per cell). All three share
          the same 20 ft grid.
        </li>
        <li>
          A cell appears on a layer only after at least 3 distinct riders
          have contributed data to it on <em>that specific layer</em>. A
          user&apos;s bumpiness contribution doesn&apos;t unlock their
          one-off brake event or close call on a sparse cell — the
          threshold applies per feature.
        </li>
        <li>
          A per-user <em>eager publish</em> toggle exists alongside the
          sharing toggle. With it on, your own contributions appear
          immediately without waiting for other riders — handy for seeding
          a region with no other contributors yet, but it makes your
          routes inferable to anyone who looks. Off is the default.
        </li>
        <li>
          <strong>
            No personally identifying data, no routes, no timestamps, and no
            per-user attribution
          </strong>{' '}
          are included in the public output. Each layer shows only the
          summed-and-averaged or counted numbers per cell.
        </li>
        <li>
          Only mounted-mode rides contribute (matching the iOS Bump Map&apos;s
          default filter); pocket-mode rides never reach the public
          aggregates.
        </li>
        <li>
          One toggle controls all three features at once — there&apos;s no
          per-feature opt-out. If you don&apos;t want close calls or brake
          events publishable but want bumpiness to be, turn sharing off.
        </li>
      </Ul>
      <p>
        Toggling sharing off triggers an immediate, atomic subtraction of
        your contributions from all three public aggregates.
      </p>

      <H2>Retention and deletion</H2>
      <Ul>
        <li>
          <strong>Local-only mode</strong> (no paired account): everything
          lives on your device. Uninstalling the app deletes it.
        </li>
        <li>
          <strong>Paired-account mode</strong>: uploaded rides persist on the
          server until you delete them or close your account. There is no
          time-based purge.
        </li>
        <li>
          <strong>Public-map contributions</strong>: withdrawing consent at{' '}
          <Link href="/settings/privacy">/settings/privacy</Link> triggers an
          immediate, atomic subtraction from the public aggregate. Once
          subtracted, your data is no longer represented in the public
          map&apos;s cell sums or counts.
        </li>
        <li>
          <strong>API tokens</strong>: revoke any time at{' '}
          <Link href="/settings/tokens">/settings/tokens</Link>. Tokens are
          stored as a SHA-256 hash; the plaintext is shown exactly once at
          creation and never retrievable afterwards.
        </li>
        <li>
          <strong>Account deletion</strong>: a self-service flow at{' '}
          <code>/settings</code> is on the roadmap. In the meantime, email{' '}
          <a href="mailto:me@jordaneccl.es">me@jordaneccl.es</a> and
          we will delete your account, all associated rides, and all
          aggregate contributions within seven days.
        </li>
      </Ul>

      <H2>Third parties and tracking</H2>
      <Ul>
        <li>
          BumpyRide does not share data with any third parties — not for
          analytics, not for advertising, not for any other purpose.
        </li>
        <li>The app contains no analytics SDKs, tracking SDKs, or ad SDKs.</li>
        <li>The app contains no in-app advertising.</li>
        <li>
          The only external network destination is bumpyride.me itself —
          and only when you have paired a web account.
        </li>
      </Ul>

      <H2>Children</H2>
      <p>
        BumpyRide is not directed at children under 13 and does not knowingly
        collect data from them. If you believe a minor has shared data with
        us, email <a href="mailto:me@jordaneccl.es">me@jordaneccl.es</a>{' '}
        and we will delete it.
      </p>

      <H2>Your rights (California, EU, and everywhere else)</H2>
      <p>
        Wherever you live, you have the right to access, correct, and delete
        the data BumpyRide holds about you. We use the same mechanism for
        every region:
      </p>
      <Ul>
        <li>
          Access: your data is visible at{' '}
          <Link href="/rides">/rides</Link>, your aggregate at{' '}
          <Link href="/bump-map">/bump-map</Link>, and your settings at{' '}
          <code>/settings</code>.
        </li>
        <li>Correct: rename or trim rides from the iOS app; the change syncs to the web.</li>
        <li>
          Delete: see the &ldquo;Retention and deletion&rdquo; section above.
        </li>
      </Ul>

      <H2>Changes to this policy</H2>
      <p>
        We will communicate changes to this policy by updating this page and
        bumping the effective date at the top. There is no separate
        notification mechanism; if you have a bumpyride.me account, we will
        also email you about any change that meaningfully expands what data
        we collect or who has access to it.
      </p>

      <H2>Contact</H2>
      <p>
        Questions about this policy? Email{' '}
        <a href="mailto:me@jordaneccl.es">me@jordaneccl.es</a>.
      </p>
    </article>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 text-xl font-semibold tracking-tight">{children}</h2>
  );
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-6">{children}</ul>;
}
