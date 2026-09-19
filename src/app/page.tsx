import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  description:
    'BumpyRide turns your phone into a road sensor. Ride normally and it maps rough pavement, hard-braking spots, and close calls — building a free public map of which streets are safe to ride and which ones need fixing.',
};

const APP_STORE_URL = 'https://apps.apple.com/app/id6769580787';

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* ---------------------------------------------------------- Hero */}
      <header className="flex flex-col items-center pt-4 text-center">
        <Image
          src="/icon-192.png"
          alt=""
          width={80}
          height={80}
          priority
          className="rounded-2xl shadow-lg"
        />
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Every ride helps fix the road
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-text-muted">
          BumpyRide turns your phone into a road sensor. Ride like you
          normally would — it maps the rough pavement, the corners where
          riders slam on the brakes, and the near-misses that never make it
          into a crash report.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <a
            href={APP_STORE_URL}
            className="rounded-lg bg-accent-strong px-6 py-3 font-medium text-white hover:bg-accent-strong/90"
          >
            Get it for iPhone — free
          </a>
          <Link
            href="/map"
            className="rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent"
          >
            See the public map
          </Link>
        </div>
        <p className="mt-3 text-xs text-text-dim">
          No account needed to browse the map.
        </p>
      </header>

      {/* -------------------------------------------------- Screenshots */}
      <section className="mt-14">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <Shot
            src="/screenshots/ride-detail.png"
            alt="A recorded ride in the BumpyRide app: a bumpiness trace reading 0.72 g, above a route coloured green through orange as the pavement worsens."
            caption="See exactly where your ride got rough."
          />
          <Shot
            src="/screenshots/bump-map.png"
            alt="The BumpyRide bump map, showing a street scored in 20-foot coloured cells from green to red."
            caption="Every 20 feet of street you ride, scored."
          />
          <Shot
            src="/screenshots/saved-rides.png"
            alt="The saved rides list in BumpyRide, showing distance, duration and roughness for recent rides."
            caption="Your whole riding history, one tap away."
          />
        </div>
      </section>

      {/* ----------------------------------------------------- For riders */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          What you get as a rider
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card title="Pick a better route">
            Find out which streets are smooth and which ones will rattle
            your teeth — before you ride them, not after.
          </Card>
          <Card title="See your ride in detail">
            Every ride comes back as a map coloured by how rough the road
            was, with your hard brakes and close calls marked on it.
          </Card>
          <Card title="Report it in one tap">
            Blocked bike lane? Close call? One button, no typing, no menus
            — it works one-handed and with gloves on.
          </Card>
          <Card title="Earn points for new ground">
            You score the most for streets nobody has mapped yet, and keep
            earning for coming back to check on them.{' '}
            <Link href="/score" className="text-accent hover:underline">
              See how scoring works
            </Link>
            .
          </Card>
        </div>
      </section>

      {/* ------------------------------------------- For cities / safety */}
      <section className="mt-16 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="text-2xl font-semibold tracking-tight">
          Data that cities can actually use
        </h2>
        <p className="mt-3 max-w-3xl text-text-muted">
          Most of what makes a street feel unsafe never gets written down
          anywhere. BumpyRide is an attempt to write it down — measured the
          same way, everywhere, by the people actually riding.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card title="Near-misses you'd never otherwise hear about">
            A crash gets a police report. The hundreds of near-misses
            before it get nothing at all. Riders log those in one tap, with
            a location attached.
          </Card>
          <Card title="Pavement complaints with evidence">
            Not &ldquo;the road is bad&rdquo; — a specific 20-foot stretch,
            measured on many trips by many different riders.
          </Card>
          <Card title="The intersections that scare people">
            Somewhere riders brake hard again and again is usually
            somewhere that needs a second look.
          </Card>
          <Card title="Blocked lanes, logged as they happen">
            When a bike lane stops working, riders mark it in the moment.
            You get a map of where and how often.
          </Card>
          <Card title="No hardware, no budget line">
            The sensors are already in riders&apos; pockets. Nothing to
            install, nothing to maintain.
          </Card>
          <Card title="Open to everyone">
            The public map is free to browse and export, with no account
            and no licence terms to negotiate.
          </Card>
        </div>
        <Link
          href="/map"
          className="mt-6 inline-block font-medium text-accent hover:underline"
        >
          Browse the public map →
        </Link>
      </section>

      {/* -------------------------------------------------- How it works */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          <Step n={1} title="Start a ride">
            Phone on your handlebars or in your pocket — both work. Then
            put it away.
          </Step>
          <Step n={2} title="Just ride">
            It feels the road underneath you, notices when you brake hard,
            and otherwise stays out of the way. It keeps going with the
            screen off.
          </Step>
          <Step n={3} title="Your ride syncs here">
            Look back at any ride on bumpyride.me, and add it to the public
            map if you want to.
          </Step>
        </ol>
      </section>

      {/* ------------------------------------------------------ Privacy */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Your rides are private until you say otherwise
        </h2>
        <ul className="mt-5 space-y-3 text-text-muted">
          <li>
            <strong className="text-text">Sharing starts off.</strong>{' '}
            Nothing you record reaches the public map until you turn it on
            in{' '}
            <Link href="/settings/privacy" className="text-accent hover:underline">
              your privacy settings
            </Link>
            .
          </li>
          <li>
            <strong className="text-text">
              Even then, your route never leaves.
            </strong>{' '}
            Only an average for a patch of street is shared — never the
            path you took, never when you rode, never your name.
          </li>
          <li>
            <strong className="text-text">
              Nothing publishes from one person alone.
            </strong>{' '}
            A stretch of street appears on the public map only after at
            least three different riders have ridden it.
          </li>
          <li>
            <strong className="text-text">
              Anything you label yourself stays yours.
            </strong>{' '}
            Custom notes you add to an event are visible on your own map
            and nowhere else, ever.
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------ Closing CTA */}
      <section className="mt-16 flex flex-col items-center rounded-2xl border border-accent-strong/40 bg-accent-soft p-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Start mapping your commute
        </h2>
        <p className="mt-2 max-w-xl text-text-muted">
          Free on the App Store. Your first ride already tells you
          something; a few weeks of them start telling your city something.
        </p>
        <a
          href={APP_STORE_URL}
          className="mt-5 rounded-lg bg-accent-strong px-6 py-3 font-medium text-white hover:bg-accent-strong/90"
        >
          Get it for iPhone — free
        </a>
      </section>

      {/* ------------------------------------------- Detail, for the curious */}
      <section className="mt-12">
        <details className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-5 py-4 font-medium text-text-muted hover:text-text">
            The technical details, if you want them
          </summary>
          <div className="space-y-3 border-t border-border px-5 py-4 text-sm text-text-muted">
            <p>
              While you ride, the phone samples its accelerometer at 50 Hz
              and projects the reading onto gravity, so it measures the
              road going up and down rather than you pedalling or turning.
              That vertical component, as a one-second RMS, becomes a{' '}
              <em>bumpiness</em> score in g — one for roughly every 10 feet
              of travel.
            </p>
            <p>
              Carrying the phone on your body instead of the frame adds
              your cadence to the signal, so Pocket Mode applies a 3 Hz
              high-pass filter to remove it. Each ride records which mode
              it used. Pocket-mode rides stay on your own map and never
              reach the public aggregate.
            </p>
            <p>
              After a ride, the app re-reads it for sustained decelerations
              — above 2.5 m/s² (0.25 g) for 0.8 seconds or more — and tags
              those as hard brakes. Close calls and other events are
              tapped by you in the moment.
            </p>
            <p>
              Everything aggregates onto a fixed 20-foot grid, identical on
              the phone and the web, so a cell means the same thing in both
              places. The public map shows a cell once at least three
              separate riders have contributed to it, and carries no
              timestamps, no routes, and no per-rider attribution.
            </p>
            <p>
              API tokens for the app are stored only as a sha256 hash — the
              token itself is shown once when you create it and is never
              recoverable afterwards. You can revoke one at any time from{' '}
              <Link
                href="/settings/tokens"
                className="text-accent hover:underline"
              >
                your token settings
              </Link>
              .
            </p>
          </div>
        </details>
      </section>

      <footer className="mt-14 border-t border-border pt-6 text-sm text-text-muted">
        BumpyRide is built in the open — the{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride"
          className="hover:underline"
        >
          iPhone app
        </a>{' '}
        and the{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride-web"
          className="hover:underline"
        >
          website
        </a>
        .
      </footer>
    </div>
  );
}

function Shot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="flex flex-col items-center">
      <Image
        src={src}
        alt={alt}
        width={294}
        height={640}
        className="w-full max-w-[240px] rounded-2xl border border-border shadow-xl"
      />
      <figcaption className="mt-3 text-center text-sm text-text-muted">
        {caption}
      </figcaption>
    </figure>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-sm text-text-muted">{children}</p>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface p-5">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-strong text-sm font-semibold text-white">
        {n}
      </div>
      <div className="mt-3 font-medium">{title}</div>
      <p className="mt-1 text-sm text-text-muted">{children}</p>
    </li>
  );
}
