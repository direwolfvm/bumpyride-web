import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ForgotForm } from './ForgotForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Reset password',
};

export default async function ForgotPage() {
  const session = await auth();
  if (session?.user) redirect('/settings/account');
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
      <p className="mt-2 text-sm text-text-muted">
        Use a recovery code (from{' '}
        <Link href="/settings/security" className="text-accent hover:underline">
          /settings/security
        </Link>
        ) or a 6-digit code from your authenticator app to set a new
        password.
      </p>
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <ForgotForm />
      </div>
      <p className="mt-4 text-sm text-text-muted">
        Don&apos;t have either? If you signed up with Google, just{' '}
        <Link href="/login" className="text-accent hover:underline">
          sign in with Google
        </Link>{' '}
        and set a password from{' '}
        <Link href="/settings/account" className="text-accent hover:underline">
          /settings/account
        </Link>
        . Otherwise email{' '}
        <a
          href="mailto:support@bumpyride.me"
          className="text-accent hover:underline"
        >
          support@bumpyride.me
        </a>
        .
      </p>
    </div>
  );
}
