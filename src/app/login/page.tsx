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
    <div style={{ maxWidth: 360 }}>
      <h1>Sign in</h1>
      <LoginForm next={next} />
      <p style={{ marginTop: '1.5rem', fontSize: 14, color: '#9a9aac' }}>
        Don&apos;t have an account?{' '}
        <Link href={signupHref} style={{ color: '#9bb4ff' }}>
          Sign up
        </Link>
        .
      </p>
    </div>
  );
}
