import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  description:
    'BumpyRide is a road-roughness tracker: an iPhone app for recording rides, plus a web app for syncing, browsing, and contributing to a public bump map.',
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
          vertical acceleration alongside GPS, your rides build into a heat
          map at 20 ft resolution, and consenting riders contribute to a
          public map of pavement quality across the city.
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
          Over many rides those samples accumulate into 20-foot grid cells.
          Useful for finding the smoother route to work, flagging streets
          for repair, or simply understanding what your commute is
          actually like.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
          On your iPhone
        </h2>
        <div className="mt-4 rounded-lg border border-accent-strong/40 bg-accent-soft p-4 text-sm">
          <p>
            <strong>The iOS app is in private preview.</strong> Watch{' '}
            <a
              href="https://github.com/direwolfvm/bumpyride"
              className="hover:underline"
            >
              the repository
            </a>{' '}
            for release news. Sync, accounts, and the public map on this
            site are open today.
          </p>
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
            colored route, a bumpiness-over-time chart, and inline title
            editing. Web edits and iOS edits both go through the same
            schema, so renames stay in sync.
          </Feature>
          <Feature title="Your bump map">
            Same 20 ft grid as the phone, same purple-glow halo, but in your
            browser. Built from a per-user aggregate so it only ever shows
            your own rides.
          </Feature>
          <Feature title="Public aggregated map">
            Anonymous, no account needed. Cells appear only after they have at
            least 3 samples — so a single rider&apos;s solo route never
            publishes on its own. Only mounted-mode rides contribute (matching
            the iOS Bump Map&apos;s default filter), so the public data
            reflects calibrated sensor readings rather than pocket-damped
            ones. No timestamps, no routes, no per-user attribution.{' '}
            <Link href="/map" className="hover:underline">
              See the live map →
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
          Your rides are yours. Contributing to the public map is{' '}
          <strong>off by default</strong> — you turn it on at{' '}
          <Link href="/settings/privacy" className="hover:underline">
            /settings/privacy
          </Link>
          . Even when on, only the aggregated cells leave your account:
          never your route, never your timestamps, never anything that
          traces back to you individually. Toggling sharing off subtracts
          your contributions; we maintain the invariant{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-sm">
            public cells = sum of mounted-or-legacy points from opted-in users
          </code>{' '}
          at all times. Pocket-mode rides stay in your personal view and
          never reach the public aggregate.
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
