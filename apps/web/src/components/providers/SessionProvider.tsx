'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import { Session } from 'next-auth';

interface SessionProviderProps {
  children: React.ReactNode;
  session?: Session | null;
}

export function SessionProvider({ children, session }: SessionProviderProps) {
  // The NextAuth handlers live under /api/v1/auth (see lib/auth.ts basePath), so
  // the client must use the same base or useSession/signIn/signOut hit the
  // default /api/auth/* and 404.
  return (
    <NextAuthSessionProvider session={session} basePath="/api/v1/auth">
      {children}
    </NextAuthSessionProvider>
  );
}
