import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/db';
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from '@/db/schema';

// Auth.js v5. JWT session strategy so we don't hit the DB on every request
// for session lookup. The DrizzleAdapter is still wired up so OAuth account
// linking has a place to persist.
//
// Credentials provider intentionally only accepts users created via
// /api/auth/signup (those have a passwordHash). Google-only users won't be
// able to sign in via the email/password form.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').trim().toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        const row = await db.query.users.findFirst({
          where: eq(users.email, email),
        });
        if (!row || !row.passwordHash) return null;
        // Anonymized users are orphan rows that exist only to hold
        // public-map data — no sign-in path should ever issue a
        // session for one, even if a credential somehow matched.
        if (row.anonymizedAt) return null;

        const ok = await bcrypt.compare(password, row.passwordHash);
        if (!ok) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.name ?? null,
          image: row.image ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, `user.id` is the db row id; pin it onto the JWT
      // so subsequent requests can read it without a DB round-trip.
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
