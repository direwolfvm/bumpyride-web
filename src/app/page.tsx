import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  description:
    'BumpyRide is a cycling road-quality tracker: an iPhone app that captures pavement roughness, hard-brake events, and rider-tapped close calls, plus a web app for syncing, browsing, and contributing to three public-aggregated safety layers.',
};

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-col items-center text-center">
        <Image
          src="/icon-192.png"
          alt=""
          width={96}
          height={96}
          priority
          className="rounded-2xl shadow-lg"
        />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
          Map road roughness with your iPhone
        </h1>
        <p className="mt-4 max-w-xl text-lg text-text-muted">
          BumpyRide turns a cycling commute into data. Your phone records
          vertical acceleration alongside GPS, detects hard brakes
          post-hoc, and lets you tap to log near-misses while you ride.
          Three public maps — pavement bumpiness, hard brakes, and close
          calls — aggregate across consenting riders at 20 ft resolution.
        </p>
      </header>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
          How it works
        </h2>
        <p className="mt-3">
          As you ride, your iPhone samples accelerometer data at 50 Hz and
          projects it onto gravity — so the math works whether the phone is
          in your jersey pocket, your handlebar mount, or anywhere in
          between. The vertical component, windowed to a one-second RMS,
          becomes a <em>bumpiness</em> score in g. Every few feet of road
          gets one.
        </p>
        <p className="mt-3">
          When you finish a ride, the app sweeps the points for sustained
          decelerations and tags them as <em>hard brakes</em>. During the
          ride you can also tap <em>Log Close Call</em> to flag a near-miss
          on the spot — minimal interaction so it works one-handed.
        </p>
        <p className="mt-3">
          Over many rides those signals accumulate into 20-foot grid cells.
          Useful for finding the smoother route to work, flagging streets
          for repair, mapping intersections that consistently force hard
          brakes, or simply understanding what your commute is actually
          like.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
          On your iPhone
        </h2>
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-accent-strong/40 bg-accent-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>Now available on the App Store.</strong> Free download
            for iPhone — record rides, see your personal bump map, and sync
            with your account here.
          </p>
          <a
            href="https://apps.apple.com/app/id6769580787"
            className="inline-block shrink-0 rounded bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent-strong/90"
          >
            Download on the App Store
          </a>
        </div>
        <ul className="mt-4 space-y-3">
          <Feature title="Live recording">
            GPS path plus 50 Hz accelerometer, sampled every 10 ft of travel.
            Vertical-only filtering via gravity projection so pedaling and
            braking don&apos;t read as bumps.
          </Feature>
          <Feature title="Pocket Mode">
            Optional 3 Hz Butterworth high-pass that cancels body cadence
            when the phone rides on you instead of the frame. Each ride is
            tagged with its sensing mode for later analysis.
          </Feature>
          <Feature title="Seismograph + bumpiness readout">
            Real-time vertical-acceleration waveform with a one-second RMS
            score, alongside a color-coded route polyline that turns red
            (then purple) as the pavement gets worse.
          </Feature>
          <Feature title="Hard-brake detection">
            Post-ride sweep of GPS-derived deceleration plus horizontal
            user-acceleration, picking out sustained brakes above
            2.5 m/s² (0.25 g) lasting 0.8 s or more. Rides re-run through
            the detector on app launch so legacy rides get backfilled.
          </Feature>
          <Feature title="Log Close Call">
            One-handed button you can tap mid-ride to mark a near-miss in
            place. Five-second undo. No severity slider or notes — just
            id + time + location, intentionally minimal so the
            interaction stays safe.
          </Feature>
          <Feature title="Saved rides">
            Editable titles, scrubbable playback with the chart and zoom,
            trim and split, plus export-to-Photos for a clean shareable image
            of the route.
          </Feature>
          <Feature title="Bump map tab">
            Aggregates everything you&apos;ve recorded into a 20 ft grid,
            rendered as colored cells with a purple-glow halo so sparse
            data stays visible at any zoom level.
          </Feature>
          <Feature title="Background recording">
            Keeps recording when the screen locks or the app is in the
            background, with the iOS location indicator on for the whole
            ride so you always know it&apos;s working.
          </Feature>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
          On the web — bumpyride.me
        </h2>
        <ul className="mt-4 space-y-3">
          <Feature title="Mirror of your rides">
            Every ride synced from your phone shows up here with the same
            colored route, a bumpiness-over-time chart, red dots for the
            ride&apos;s hard brakes, violet diamonds for any close calls
            you logged, and inline title editing. Web edits and iOS edits
            both go through the same schema, so renames stay in sync.
          </Feature>
          <Feature title="Your bump map">
            Same 20 ft grid as the phone, same purple-glow halo, but in your
            browser. Built from a per-user aggregate so it only ever shows
            your own rides.
          </Feature>
          <Feature title="Public aggregated maps">
            Anonymous, no account needed. Three layers on the same 20 ft
            cell grid — pavement bumpiness, hard brakes, and close calls
            — switchable via tabs. Each cell appears only after at least
            three distinct riders have contributed, so a single rider&apos;s
            data never publishes on its own. Only mounted-mode rides
            contribute (matching the iOS Bump Map&apos;s default filter).
            No timestamps, no routes, no per-user attribution.{' '}
            <Link href="/map" className="hover:underline">
              See the live maps →
            </Link>
          </Feature>
          <Feature title="iOS sync">
            Two pairing paths: paste an API token from{' '}
            <Link href="/settings/tokens" className="hover:underline">
              /settings/tokens
            </Link>
            , or tap <em>Sign in with bumpyride.me</em> in the iOS app for a
            one-tap browser round-trip that mints a token automatically.
          </Feature>
          <Feature title="Theme">
            Light, dark, or follow your OS — including a matching dark
            basemap so the public map fits whichever theme you&apos;re in.
          </Feature>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
          Privacy by default
        </h2>
        <p className="mt-3">
          Your rides are yours. Contributing to the public maps is{' '}
          <strong>off by default</strong> — you turn it on at{' '}
          <Link href="/settings/privacy" className="hover:underline">
            /settings/privacy
          </Link>
          . Even when on, only aggregated cells leave your account:
          never your route, never your timestamps, never anything that
          traces back to you individually. The same threshold applies
          per-feature, so a single brake event or close call on a quiet
          corner is held back from the public map until at least three
          distinct riders have hit that cell. Pocket-mode rides stay in
          your personal view and never reach the public aggregate.
        </p>
        <p className="mt-3">
          API tokens for the iOS app are hashed at rest with sha256; the
          plaintext is shown exactly once at creation and never retrievable
          afterwards. Revoke any token at any time from{' '}
          <Link href="/settings/tokens" className="hover:underline">
            /settings/tokens
          </Link>
          .
        </p>
      </section>

      <footer className="mt-16 border-t border-border pt-6 text-sm text-text-muted">
        BumpyRide is built in the open. The iOS app lives at{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride"
          className="hover:underline"
        >
          github.com/direwolfvm/bumpyride
        </a>
        ; the web app at{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride-web"
          className="hover:underline"
        >
          github.com/direwolfvm/bumpyride-web
        </a>
        .
      </footer>
    </div>
  );
}

function Feature({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-text-muted">{children}</p>
    </li>
  );
}
