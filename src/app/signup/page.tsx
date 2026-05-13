import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SignupForm } from './SignupForm';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect('/');
  return (
    <div style={{ maxWidth: 360 }}>
      <h1>Create account</h1>
      <SignupForm />
      <p style={{ marginTop: '1.5rem', fontSize: 14, color: '#9a9aac' }}>
        Already have an account?{' '}
        <Link href="/login" style={{ color: '#9bb4ff' }}>
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
