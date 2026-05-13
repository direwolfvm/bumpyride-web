import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { ThemeInit } from '@/components/ThemeInit';
import { ThemeToggle } from '@/components/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'BumpyRide',
  description: 'Companion web app for BumpyRide iOS.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" data-theme="system" className="bg-bg text-text">
      <head>
        <ThemeInit />
      </head>
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link
              href="/"
              className="text-base font-semibold tracking-tight text-text no-underline hover:no-underline"
            >
              BumpyRide
            </Link>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <Link href="/map" className="text-accent hover:underline">
                Public map
              </Link>
              {session?.user ? (
                <>
                  <Link href="/rides" className="text-accent hover:underline">
                    Rides
                  </Link>
                  <Link href="/bump-map" className="text-accent hover:underline">
                    My bump map
                  </Link>
                  <Link
                    href="/settings/tokens"
                    className="text-accent hover:underline"
                  >
                    iOS tokens
                  </Link>
                  <Link
                    href="/settings/privacy"
                    className="text-accent hover:underline"
                  >
                    Privacy
                  </Link>
                  <span className="hidden text-text-muted sm:inline">
                    {session.user.email}
                  </span>
                  <ThemeToggle />
                  <form
                    action={async () => {
                      'use server';
                      await signOut({ redirectTo: '/' });
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded border border-border-strong px-3 py-1 text-text-muted hover:border-accent hover:text-text"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" className="text-accent hover:underline">
                    Sign in
                  </Link>
                  <Link href="/signup" className="text-accent hover:underline">
                    Sign up
                  </Link>
                  <ThemeToggle />
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
