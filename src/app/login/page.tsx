import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/');
  return (
    <div style={{ maxWidth: 360 }}>
      <h1>Sign in</h1>
      <LoginForm />
      <p style={{ marginTop: '1.5rem', fontSize: 14, color: '#9a9aac' }}>
        Don&apos;t have an account?{' '}
        <Link href="/signup" style={{ color: '#9bb4ff' }}>
          Sign up
        </Link>
        .
      </p>
    </div>
  );
}
