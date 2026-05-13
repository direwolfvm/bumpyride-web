import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'BumpyRide',
  description: 'Companion web app for BumpyRide iOS.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: '2rem',
          background: '#0b0b10',
          color: '#e8e8ee',
        }}
      >
        {children}
      </body>
    </html>
  );
}
