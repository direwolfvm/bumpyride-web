import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { auth, signOut } from '@/auth';

export const metadata: Metadata = {
  title: 'BumpyRide',
  description: 'Companion web app for BumpyRide iOS.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          background: '#0b0b10',
          color: '#e8e8ee',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1.5rem',
            borderBottom: '1px solid #22222c',
            background: '#101019',
          }}
        >
          <Link
            href="/"
            style={{
              color: '#e8e8ee',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            BumpyRide
          </Link>
          <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {session?.user ? (
              <>
                <Link href="/settings/tokens" style={navLink}>
                  iOS tokens
                </Link>
                <span style={{ color: '#9a9aac', fontSize: 14 }}>
                  {session.user.email}
                </span>
                <form
                  action={async () => {
                    'use server';
                    await signOut({ redirectTo: '/' });
                  }}
                >
                  <button type="submit" style={buttonReset}>
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" style={navLink}>
                  Sign in
                </Link>
                <Link href="/signup" style={navLink}>
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>
        <main style={{ padding: '2rem' }}>{children}</main>
      </body>
    </html>
  );
}

const navLink = {
  color: '#9bb4ff',
  textDecoration: 'none',
  fontSize: 14,
};

const buttonReset = {
  background: 'transparent',
  border: '1px solid #44445c',
  color: '#e8e8ee',
  padding: '0.25rem 0.75rem',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
};
