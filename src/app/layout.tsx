import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { ThemeInit } from '@/components/ThemeInit';
import { ThemeToggle } from '@/components/ThemeToggle';
import './globals.css';

// Favicon + Apple touch icon are picked up by Next from src/app/icon.png
// and src/app/apple-icon.png. We only need to spell out the OG image,
// which is the brand mark from the iOS app at 512×512.
export const metadata: Metadata = {
  title: { default: 'BumpyRide', template: '%s · BumpyRide' },
  description:
    'Companion web app for the BumpyRide iOS app — sync rides, see road roughness, browse the public bump map.',
  openGraph: {
    title: 'BumpyRide',
    description: 'Map road roughness with your iPhone.',
    images: ['/icon-512.png'],
  },
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
              className="flex items-center gap-2 text-base font-semibold tracking-tight text-text no-underline hover:no-underline"
            >
              <Image
                src="/icon-48.png"
                alt=""
                width={24}
                height={24}
                priority
                className="rounded"
              />
              <span>BumpyRide</span>
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
                    href="/settings/account"
                    className="text-accent hover:underline"
                  >
                    Account
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
                    Sharing
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
        <footer className="mx-auto mt-12 max-w-7xl border-t border-border px-4 py-6 text-sm text-text-muted sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <div>
              © {new Date().getFullYear()} Herbert Industries. Built in the
              open at{' '}
              <a
                href="https://github.com/direwolfvm/bumpyride-web"
                className="hover:underline"
              >
                github.com/direwolfvm
              </a>
              .
            </div>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href="/privacy" className="hover:underline">
                Privacy policy
              </Link>
              <Link href="/support" className="hover:underline">
                Support
              </Link>
              <a
                href="https://github.com/direwolfvm/bumpyride-web/blob/main/LICENSE"
                className="hover:underline"
              >
                License
              </a>
              <a
                href="mailto:me@jordaneccl.es"
                className="hover:underline"
              >
                me@jordaneccl.es
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
