'use client';

import { useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: 'USER' | 'ADMIN';
}

interface UseAuthReturn {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Sotto is self-hosted for a household with no login. The current user is the
 * active profile (chosen from the picker); their profile is fetched once from
 * /api/v1/users/me so the header can show a name, avatar, and the real role
 * (owner is ADMIN, learners are USER). Switching profiles happens through the
 * picker, not here.
 */
export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/users/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            id?: string;
            name?: string | null;
            email?: string | null;
            image?: string | null;
            role?: 'USER' | 'ADMIN';
          } | null
        ) => {
          if (!active) return;
          if (data?.id) {
            setUser({
              id: data.id,
              name: data.name ?? null,
              email: data.email ?? null,
              image: data.image ?? null,
              role: data.role === 'ADMIN' ? 'ADMIN' : 'USER',
            });
          }
          setIsLoading(false);
        }
      )
      .catch(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { user, isAuthenticated: true, isLoading };
}
