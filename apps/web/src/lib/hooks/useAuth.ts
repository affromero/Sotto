'use client';

import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react';
import { useCallback } from 'react';

interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
}

interface UseAuthReturn {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: () => void;
  signOut: () => void;
}

export function useAuth(): UseAuthReturn {
  const { data: session, status } = useSession();

  const isLoading = status === 'loading';
  const isAuthenticated = status === 'authenticated';

  const user: AuthUser | null = session?.user
    ? {
        id: session.user.id as string,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role: ((session.user as Record<string, unknown>).role as string) ?? 'USER',
      }
    : null;

  const signIn = useCallback(() => {
    nextAuthSignIn(undefined, { callbackUrl: '/auth/login' });
  }, []);

  const signOut = useCallback(() => {
    nextAuthSignOut({ callbackUrl: '/' });
  }, []);

  return { user, isAuthenticated, isLoading, signIn, signOut };
}
