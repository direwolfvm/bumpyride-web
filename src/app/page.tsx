import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();
  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>BumpyRide</h1>
      <p>
        Companion web app for the BumpyRide iOS app. Mirror your rides, view
        routes, and see the global aggregated bump map.
      </p>
      {session?.user ? (
        <p>
          Signed in as <strong>{session.user.email}</strong>. Manage your iOS
          sync tokens at{' '}
          <Link href="/settings/tokens" style={{ color: '#9bb4ff' }}>
            /settings/tokens
          </Link>
          .
        </p>
      ) : (
        <p>
          <Link href="/login" style={{ color: '#9bb4ff' }}>
            Sign in
          </Link>{' '}
          or{' '}
          <Link href="/signup" style={{ color: '#9bb4ff' }}>
            create an account
          </Link>{' '}
          to get started.
        </p>
      )}
      <h2>API</h2>
      <ul>
        <li>
          <code>GET /api/health</code> — liveness check
        </li>
        <li>
          <code>POST /api/sync/ride</code> — accepts a single ride payload
          (Bearer-authenticated; tokens issued at <code>/settings/tokens</code>)
        </li>
      </ul>
    </div>
  );
}
