import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      // Null when the account signs in with a username — we send no
      // email, so an address is optional. See lib/identity.ts.
      email?: string | null;
      /** How this account signs in: its username, or its email address. */
      identifier?: string | null;
      image?: string | null;
    };
  }
}
