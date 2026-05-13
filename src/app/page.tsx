import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();
  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>BumpyRide</h1>
      <p>
        Companion web app for the{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride"
          style={{ color: '#9bb4ff' }}
        >
          BumpyRide iOS app
        </a>
        . Browse your synced rides, see a per-user heat map of road
        roughness, and explore the{' '}
        <Link href="/map" style={{ color: '#9bb4ff' }}>
          public bump map
        </Link>{' '}
        contributed by consenting riders.
      </p>
      {session?.user ? (
        <ul>
          <li>
            Browse your{' '}
            <Link href="/rides" style={{ color: '#9bb4ff' }}>
              rides
            </Link>
          </li>
          <li>
            See your aggregated{' '}
            <Link href="/bump-map" style={{ color: '#9bb4ff' }}>
              bump map
            </Link>
          </li>
          <li>
            Decide whether your rides contribute to the{' '}
            <Link href="/settings/privacy" style={{ color: '#9bb4ff' }}>
              public bump map
            </Link>{' '}
            (off by default)
          </li>
          <li>
            Manage{' '}
            <Link href="/settings/tokens" style={{ color: '#9bb4ff' }}>
              iOS sync tokens
            </Link>
          </li>
        </ul>
      ) : (
        <p>
          <Link href="/login" style={{ color: '#9bb4ff' }}>
            Sign in
          </Link>{' '}
          or{' '}
          <Link href="/signup" style={{ color: '#9bb4ff' }}>
            create an account
          </Link>{' '}
          to start syncing your rides from the iOS app — or jump straight
          to the{' '}
          <Link href="/map" style={{ color: '#9bb4ff' }}>
            public bump map
          </Link>
          .
        </p>
      )}
    </div>
  );
}
