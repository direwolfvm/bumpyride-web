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
    <div style={{ maxWidth: 360 }}>
      <h1>Create account</h1>
      <SignupForm next={next} />
      <p style={{ marginTop: '1.5rem', fontSize: 14, color: '#9a9aac' }}>
        Already have an account?{' '}
        <Link href={loginHref} style={{ color: '#9bb4ff' }}>
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
