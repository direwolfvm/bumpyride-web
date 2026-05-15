import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { safeNext } from '@/lib/safe-next';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const session = await auth();
  if (session?.user) redirect(next ?? '/');

  const signupHref = next
    ? `/signup?next=${encodeURIComponent(next)}`
    : '/signup';

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <LoginForm next={next} />
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Don&apos;t have an account?{' '}
        <Link href={signupHref} className="text-accent hover:underline">
          Sign up
        </Link>
        .
      </p>
      <p className="mt-2 text-sm text-text-muted">
        Forgot your password?{' '}
        <Link href="/forgot" className="text-accent hover:underline">
          Reset it
        </Link>
        .
      </p>
    </div>
  );
}
