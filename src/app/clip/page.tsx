import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BumpyRide Clip',
  description:
    'BumpyRide Clip is a free companion tool that turns the close calls and blocked lanes you logged on a ride into video clips from your own camera footage. It runs entirely on your computer — no uploads, no account.',
};

const REPO_URL = 'https://github.com/direwolfvm/bumpyride-clip';

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
            Runs on your computer
          </span>
          <span className="rounded border border-border-strong px-2 py-1 text-text-muted">
            For comfortable-with-a-terminal riders
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
          Nothing is uploaded. It runs as a small web app on your own
          machine, reads your video files where they already sit, and has
          no account, no server, and no cloud anything.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <a
            href={REPO_URL}
            className="rounded-lg bg-accent-strong px-6 py-3 font-medium text-white hover:bg-accent-strong/90"
          >
            Get it on GitHub
          </a>
          <a
            href="#setup"
            className="rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent"
          >
            What it takes to run
          </a>
        </div>
      </header>

      {/* ------------------------------------------------ Screenshot */}
      <section className="mt-12">
        <Image
          src="/screenshots/clip-overview.jpg"
          alt="BumpyRide Clip showing a loaded ride: three setup cards for the ride, the footage and the alignment, a list of reports including a close call and a blocked lane, and the matching moment playing from the rider's camera footage."
          width={800}
          height={600}
          className="w-full rounded-xl border border-border shadow-2xl"
          priority
        />
        <p className="mt-3 text-center text-sm text-text-muted">
          A ride, its footage, and the reports lined up against each other.
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
              The tool finds that marker and uses it as frame zero, then
              places every other report relative to it. If a ride has no
              marker, you can type the real start time in yourself, and
              nudge it by a few seconds if the cut looks early or late.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Trim + export */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Trim it until it says what you mean
        </h2>
        <p className="mt-3 max-w-2xl text-text-muted">
          Each clip starts as the 15 seconds either side of the moment you
          flagged. Drag the handles out to show the whole approach, or
          pull them in to the two seconds that matter. Tick the ones worth
          keeping and export them together.
        </p>
        <Image
          src="/screenshots/clip-trim.jpg"
          alt="The clip editor in BumpyRide Clip, with before and after trim controls set to 15 seconds each, a 30-second clip length, and an export button."
          width={800}
          height={600}
          className="mt-6 w-full rounded-xl border border-border shadow-2xl"
        />
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
            <strong className="text-text">There is no server to send it to.</strong>{' '}
            The app runs on your own machine and only listens to your own
            machine. No account, no database, no analytics.
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
            later — no footage, no file paths, no GPS trace.
          </li>
          <li>
            <strong className="text-text">Finishing up clears the workspace.</strong>{' '}
            Temporary previews and renders are removed when you end the
            session or stop the server.
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------------ Setup */}
      <section id="setup" className="mt-16 scroll-mt-20">
        <h2 className="text-2xl font-semibold tracking-tight">
          What it takes to run
        </h2>
        <p className="mt-3 max-w-2xl text-text-muted">
          This one is genuinely for tinkerers. There is no installer — you
          clone a repository and run it from a terminal, and it keeps
          running while you work.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-lg border border-border bg-surface p-4 text-sm">
          <code>{`git clone ${REPO_URL}
cd bumpyride-clip
npm install
npm start`}</code>
        </pre>
        <p className="mt-3 text-text-muted">
          Then open{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-sm">
            http://127.0.0.1:4317
          </code>{' '}
          and open a ride from your BumpyRide iCloud folder.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card title="You will need">
            Node.js 22 or newer. The first install downloads FFmpeg, which
            does the actual video work; after that it runs offline.
          </Card>
          <Card title="Worth knowing">
            Exporting re-encodes video so the cuts land in the right
            place, which takes real time on long clips. Accurate beats
            instant here.
          </Card>
        </div>
        <p className="mt-6 text-sm text-text-dim">
          Built for macOS, where it can read your BumpyRide iCloud folder
          directly and open files with a native picker. It runs elsewhere
          too, pointing it at video files by path instead. FFmpeg is
          licensed separately — see the notes in the repository if you
          plan to redistribute it.
        </p>
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
          href={REPO_URL}
          className="mt-5 rounded-lg bg-accent-strong px-6 py-3 font-medium text-white hover:bg-accent-strong/90"
        >
          Get it on GitHub
        </a>
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
