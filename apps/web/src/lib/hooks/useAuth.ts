'use client';

import { useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: 'ADMIN';
}

interface UseAuthReturn {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Sotto is fully self-hosted for a single learner — there is no login. The
 * current user is the one local owner; their profile is fetched once from
 * /api/v1/users/me so the header can show a name and avatar. There is no
 * sign-in, sign-out, or account switching.
 */
export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/users/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { id?: string; name?: string | null; email?: string | null; image?: string | null } | null) => {
        if (!active) return;
        if (data?.id) {
          setUser({
            id: data.id,
            name: data.name ?? null,
            email: data.email ?? null,
            image: data.image ?? null,
            role: 'ADMIN',
          });
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { user, isAuthenticated: true, isLoading };
}
