'use client';

import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  isImpersonating?: boolean;
  impersonatedRole?: string;
  originalUser?: { id: string; name: string | null; image: string | null };
}

interface UseAuthReturn {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: () => void;
  signOut: () => void;
  impersonate: (userId: string) => Promise<void>;
  stopImpersonating: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const { data: session, status, update } = useSession();
  const router = useRouter();

  const isLoading = status === 'loading';
  const isAuthenticated = status === 'authenticated';

  const sessionUser = session?.user as Record<string, unknown> | undefined;
  const user: AuthUser | null = sessionUser
    ? {
        id: sessionUser.id as string,
        name: (sessionUser.name as string) ?? null,
        email: (sessionUser.email as string) ?? null,
        image: (sessionUser.image as string) ?? null,
        role: (sessionUser.role as string) ?? 'USER',
        isImpersonating: (sessionUser.isImpersonating as boolean) ?? false,
        impersonatedRole: (sessionUser.impersonatedRole as string) ?? undefined,
        originalUser: sessionUser.originalUser as AuthUser['originalUser'],
      }
    : null;

  const signIn = useCallback(() => {
    nextAuthSignIn(undefined, { callbackUrl: '/learn' });
  }, []);

  const signOut = useCallback(() => {
    nextAuthSignOut({ callbackUrl: '/' });
  }, []);

  const impersonate = useCallback(async (userId: string) => {
    await update({ impersonateUserId: userId });
    router.refresh();
  }, [update, router]);

  const stopImpersonating = useCallback(async () => {
    await update({ stopImpersonating: true });
    router.refresh();
  }, [update, router]);

  return { user, isAuthenticated, isLoading, signIn, signOut, impersonate, stopImpersonating };
}
