import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BumpyRide Clip',
  description:
    'BumpyRide Clip is a free companion tool that turns the close calls and blocked lanes you logged on a ride into video clips from your own camera footage. It runs entirely on your computer — no uploads, no account.',
};

const REPO_URL = 'https://github.com/direwolfvm/bumpyride-clip';
const DMG_URL = '/downloads/BumpyRide-Clip-1.0.dmg';
const DMG_VERSION = '1.0';
const DMG_SIZE = '815 KB';

export default function ClipPage() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* ------------------------------------------------------- Hero */}
      <header className="pt-2">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide">
          <span className="rounded border border-border-strong px-2 py-1 text-text-muted">
            Companion tool
          </span>
          <span className="rounded border border-border-strong px-2 py-1 text-text-muted">
            Native Mac app
          </span>
          <span className="rounded border border-border-strong px-2 py-1 text-text-muted">
            Free · signed &amp; notarized
          </span>
        </div>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
          Turn the moments you flagged into video
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-text-muted">
          You tapped to log a close call. Your camera was already
          recording. <strong className="text-text">BumpyRide Clip</strong>{' '}
          puts those two things together — it reads the ride, lines the
          footage up against it, and cuts out the seconds around each
          thing you flagged.
        </p>
        <p className="mt-3 max-w-2xl text-text-muted">
          Nothing is uploaded. It is a Mac app that reads your video files
          where they already sit — no account, no server, no network
          connection, and nothing to install alongside it.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <a
            href={DMG_URL}
            className="rounded-lg bg-accent-strong px-6 py-3 font-medium text-white hover:bg-accent-strong/90"
          >
            Download for Mac — free
          </a>
          <a
            href="#other-platforms"
            className="rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent"
          >
            Windows or Linux?
          </a>
        </div>
        <p className="mt-3 text-xs text-text-dim">
          Version {DMG_VERSION} · {DMG_SIZE} · macOS 26.2 or later · signed
          and notarized by Apple, so it opens with a double-click.
        </p>
      </header>

      {/* ------------------------------------------------ Screenshot */}
      <section className="mt-12">
        <Image
          src="/screenshots/clip-macos.jpg"
          alt="The BumpyRide Clip Mac app, with a reports sidebar and a toolbar offering Link Videos, Manage Videos, Video Sync, Save Project and Clip Inspector."
          width={1200}
          height={773}
          className="w-full rounded-xl border border-border shadow-2xl"
          priority
        />
        <p className="mt-3 text-center text-sm text-text-muted">
          Open a ride, link the footage, and work through what you flagged.
        </p>
      </section>

      {/* ------------------------------------------------ What it does */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          What it actually does
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Card title="Your reports become the edit list">
            Every close call, blocked lane, and custom event you logged
            turns into one entry to review. Hard brakes are left out —
            they are detected after the fact, not moments you chose.
          </Card>
          <Card title="Your footage gets lined up">
            Point it at the video files from the same ride. It links them
            where they sit, in order, including files well over 4 GB, and
            never makes a second copy.
          </Card>
          <Card title="You get clips, or one reel">
            Take a single moment, or tick several and export them as one
            video in ride order. Clips can even span two camera files.
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------- Video Sync */}
      <section className="mt-16 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="text-2xl font-semibold tracking-tight">
          The trick: a report called &ldquo;Video Sync&rdquo;
        </h2>
        <p className="mt-3 max-w-3xl text-text-muted">
          The hard part of matching a ride to footage is knowing exactly
          when the video started. Camera clocks drift, filenames lie, and
          embedded timestamps disagree with each other — so the tool
          ignores all of them.
        </p>
        <p className="mt-3 max-w-3xl text-text-muted">
          Instead you tell it, using the app you already have. Start your
          camera, then log a custom event in BumpyRide named{' '}
          <strong className="text-text">Video Sync</strong>. That report is
          a timestamp you trust, taken from the same clock as every other
          report on the ride — so everything else falls into place from it.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-bg p-4">
            <div className="text-xs uppercase tracking-wide text-text-muted">
              On the bike
            </div>
            <ol className="mt-2 space-y-1.5 text-sm text-text-muted">
              <li>1. Start your camera recording.</li>
              <li>
                2. In BumpyRide, tap <em>Log Event</em> and name it{' '}
                <em>Video Sync</em>.
              </li>
              <li>3. Ride, and flag things as you normally would.</li>
            </ol>
            <p className="mt-3 text-xs text-text-dim">
              The name is matched loosely — &ldquo;video sync&rdquo;,
              &ldquo;Video-Sync&rdquo; and &ldquo;videosync&rdquo; all
              work.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-bg p-4">
            <div className="text-xs uppercase tracking-wide text-text-muted">
              Afterwards
            </div>
            <p className="mt-2 text-sm text-text-muted">
              The app finds that marker and uses it as frame zero, then
              places every other report relative to it. No marker on an
              older ride? Type the real start time in yourself.
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-bg p-4">
          <div className="text-xs uppercase tracking-wide text-text-muted">
            If a cut lands early or late
          </div>
          <p className="mt-2 text-sm text-text-muted">
            Nudge the whole ride a tenth of a second at a time until it
            sits right — or skip the arithmetic entirely: scrub until the
            frame where it actually happened is on screen, pause, and
            choose <strong className="text-text">Match event to this
            frame</strong>. The correction applies to every report on the
            ride and is saved with the project, so you only do it once.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ Trim + export */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Trim it until it says what you mean
        </h2>
        <p className="mt-3 max-w-2xl text-text-muted">
          Each clip starts as the 15 seconds before the moment you flagged
          and 5 after — enough of the approach to see it coming. Drag the
          handles out to show more, or pull them in to the two seconds
          that matter.
        </p>
        <p className="mt-3 max-w-2xl text-text-muted">
          Found a length that works? Tick the other reports and apply the
          same timing to all of them at once. A playback bar counts down
          to the flagged moment, marks it, then counts up again — a review
          aid only, never burned into what you export.
        </p>
        <Image
          src="/screenshots/clip-trim.jpg"
          alt="A clip being trimmed, with separate before and after handles, the resulting clip length, and an export button."
          width={800}
          height={600}
          className="mt-6 w-full rounded-xl border border-border shadow-2xl"
        />
        <p className="mt-3 text-sm text-text-muted">
          Trimming a clip in the browser version, which works the same way.
        </p>
      </section>

      {/* ---------------------------------------------------- Privacy */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          It never leaves your computer
        </h2>
        <p className="mt-3 max-w-2xl text-text-muted">
          Helmet-camera footage is about as personal as data gets. This
          tool is built so that none of it has to be trusted to anyone —
          including us.
        </p>
        <ul className="mt-5 space-y-3 text-text-muted">
          <li>
            <strong className="text-text">There is nowhere to send it.</strong>{' '}
            The Mac app needs no network connection at all. No account, no
            server, no database, no analytics.
          </li>
          <li>
            <strong className="text-text">Your originals are read, not copied.</strong>{' '}
            Videos are linked where they already live. Exports are new
            files, and nothing existing is ever overwritten or deleted.
          </li>
          <li>
            <strong className="text-text">Project files carry no video.</strong>{' '}
            Saving a project stores report times, your trim points, and
            enough of a fingerprint to recognise the same source files
            later — no footage, no GPS trace. The Mac app also saves a
            bookmark so it can reopen your videos without asking again,
            and that can record where those files live — so treat a
            project file as personal metadata, not something to post
            publicly.
          </li>
          <li>
            <strong className="text-text">Finishing up clears the workspace.</strong>{' '}
            Half-finished renders are cleaned up when you finish a project
            or quit, and previews are built in memory rather than written
            out as extra video files.
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------------ Setup */}
      <section id="setup" className="mt-16 scroll-mt-20">
        <h2 className="text-2xl font-semibold tracking-tight">Getting it</h2>
        <div className="mt-6 rounded-2xl border border-accent-strong/40 bg-accent-soft p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-text-muted">
                On a Mac
              </div>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">
                Download and open it
              </h3>
              <p className="mt-2 max-w-xl text-text-muted">
                It is signed and notarized by Apple, so it opens like any
                other app — no Gatekeeper warning, no right-click-to-open
                trick, nothing to build. Drag it to Applications and you
                are done.
              </p>
            </div>
            <a
              href={DMG_URL}
              className="shrink-0 rounded-lg bg-accent-strong px-6 py-3 font-medium text-white hover:bg-accent-strong/90"
            >
              Download {DMG_VERSION}
            </a>
          </div>
          <p className="mt-4 text-xs text-text-dim">
            {DMG_SIZE} · requires macOS 26.2 or later. Nothing else to
            install — no Node, no FFmpeg, and it never needs the network.
          </p>
        </div>

        <div
          id="other-platforms"
          className="mt-6 scroll-mt-20 rounded-2xl border border-border bg-surface p-6"
        >
          <div className="text-xs uppercase tracking-wide text-text-muted">
            On Windows or Linux
          </div>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">
            Run the browser version instead
          </h3>
          <p className="mt-2 max-w-2xl text-text-muted">
            The Mac app grew out of an earlier version that runs anywhere
            Node does. Same reports, same Video Sync alignment, same
            calibration — it just runs as a small web app on your own
            machine instead, which you open in a browser at{' '}
            <code className="rounded bg-bg px-1.5 py-0.5 text-sm">
              127.0.0.1:4317
            </code>
            .
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-bg p-4 text-sm">
            <code>{`git clone ${REPO_URL}
cd bumpyride-clip
npm install
npm start`}</code>
          </pre>
          <p className="mt-3 text-sm text-text-muted">
            Needs Node.js 22 or newer. The first install pulls down
            FFmpeg, which does the video work; after that it runs offline
            too. Projects saved in either version open in the other.
          </p>
          <a
            href={REPO_URL}
            className="mt-4 inline-block font-medium text-accent hover:underline"
          >
            Source and full instructions on GitHub →
          </a>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card title="Worth knowing">
            Exporting re-encodes video so the cuts land in the right
            place, which takes real time on long clips. Accurate beats
            instant here.
          </Card>
          <Card title="Verifying the download">
            SHA-256:{' '}
            <code className="break-all text-xs">
              b8412eeacbea0831b9a066d67e0aab8597cfcfba49d3b909dae0f2badccf8b1e
            </code>
          </Card>
        </div>
      </section>

      {/* -------------------------------------------------------- CTA */}
      <section className="mt-16 flex flex-col items-center rounded-2xl border border-accent-strong/40 bg-accent-soft p-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Have footage sitting on a drive?
        </h2>
        <p className="mt-2 max-w-xl text-text-muted">
          The moments are already marked in your rides. This just finds
          them.
        </p>
        <a
          href={DMG_URL}
          className="mt-5 rounded-lg bg-accent-strong px-6 py-3 font-medium text-white hover:bg-accent-strong/90"
        >
          Download for Mac — free
        </a>
        <p className="mt-3 text-sm text-text-muted">
          Not on a Mac?{' '}
          <a href="#other-platforms" className="text-accent hover:underline">
            Run the browser version
          </a>
          .
        </p>
        <p className="mt-4 text-sm text-text-muted">
          New to BumpyRide?{' '}
          <Link href="/" className="text-accent hover:underline">
            Start with the app
          </Link>
          .
        </p>
      </section>
    </div>
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
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-sm text-text-muted">{children}</p>
    </div>
  );
}
