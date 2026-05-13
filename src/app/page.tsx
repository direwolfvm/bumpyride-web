import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        BumpyRide
      </h1>
      <p className="mt-3 text-lg text-text-muted">
        Companion web app for the{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride"
          className="text-accent hover:underline"
        >
          BumpyRide iOS app
        </a>
        . Browse your synced rides, see a per-user heat map of road roughness,
        and explore the{' '}
        <Link href="/map" className="text-accent hover:underline">
          public bump map
        </Link>{' '}
        contributed by consenting riders.
      </p>

      {session?.user ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <DashCard
            href="/rides"
            title="Your rides"
            body="Synced from the iOS app, with route maps and bumpiness charts."
          />
          <DashCard
            href="/bump-map"
            title="Your bump map"
            body="Every cell you've ridden through, aggregated and colored by roughness."
          />
          <DashCard
            href="/settings/privacy"
            title="Public sharing"
            body="Off by default. Toggle to contribute your rides to the public map."
          />
          <DashCard
            href="/settings/tokens"
            title="iOS sync tokens"
            body="Issue or revoke API tokens for the iOS app."
          />
        </div>
      ) : (
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent-strong/90"
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="rounded border border-border-strong px-4 py-2 hover:border-accent"
          >
            Sign in
          </Link>
          <Link
            href="/map"
            className="rounded border border-border-strong px-4 py-2 hover:border-accent"
          >
            Browse the public map
          </Link>
        </div>
      )}
    </div>
  );
}

function DashCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-border bg-surface p-5 no-underline transition hover:border-accent hover:bg-surface-2"
    >
      <div className="font-medium text-text group-hover:text-accent">
        {title}
      </div>
      <div className="mt-1 text-sm text-text-muted">{body}</div>
    </Link>
  );
}
