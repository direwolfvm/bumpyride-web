import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { accounts, users } from '@/db/schema';
import { ProfileForm, PasswordForm } from './AccountForms';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=%2Fsettings%2Faccount');
  const userId = session.user.id;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true, passwordHash: true },
  });
  const linkedAccounts = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  if (!user) redirect('/login');

  const hasPassword = user.passwordHash != null;
  const linkedProviders = new Set(linkedAccounts.map((a) => a.provider));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Account
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        Your profile and password. Public sharing for the bump map lives at{' '}
        <Link
          href="/settings/privacy"
          className="text-accent hover:underline"
        >
          /settings/privacy
        </Link>
        .
      </p>

      <section className="mt-8 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-medium">Profile</h2>
        <p className="mt-1 text-sm text-text-muted">
          Signed in as <strong>{user.email}</strong>. Email isn&apos;t
          editable here yet — contact{' '}
          <a
            href="mailto:support@bumpyride.me"
            className="text-accent hover:underline"
          >
            support
          </a>{' '}
          if you need it changed.
        </p>
        <div className="mt-4">
          <ProfileForm initialName={user.name ?? ''} />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-medium">
          {hasPassword ? 'Change password' : 'Set a password'}
        </h2>
        {!hasPassword && (
          <p className="mt-1 text-sm text-text-muted">
            You signed in with Google. Setting a password here lets you also
            sign in with email + password — both routes will work.
          </p>
        )}
        <div className="mt-4">
          <PasswordForm requireCurrent={hasPassword} />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-medium">Sign-in methods</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex items-center justify-between">
            <span>Email + password</span>
            <span
              className={
                hasPassword
                  ? 'rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent'
                  : 'text-text-dim'
              }
            >
              {hasPassword ? 'Enabled' : 'Not set'}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span>Google</span>
            <span
              className={
                linkedProviders.has('google')
                  ? 'rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent'
                  : 'text-text-dim'
              }
            >
              {linkedProviders.has('google') ? 'Linked' : 'Not linked'}
            </span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-text-muted">
          Set up recovery codes or an authenticator app at{' '}
          <Link
            href="/settings/security"
            className="text-accent hover:underline"
          >
            /settings/security
          </Link>{' '}
          so you can reset your password if you forget it.
        </p>
      </section>
    </div>
  );
}
