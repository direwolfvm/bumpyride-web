import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { safeNext } from '@/lib/safe-next';
import { SignupForm } from './SignupForm';

export const dynamic = 'force-dynamic';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const session = await auth();
  if (session?.user) redirect(next ?? '/');

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <SignupForm next={next} />
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Already have an account?{' '}
        <Link href={loginHref} className="text-accent hover:underline">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
