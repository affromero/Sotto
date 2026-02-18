import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from '@/lib/hooks/useAuth';
import * as nextAuthReact from 'next-auth/react';
import type { UserRole } from '@prisma/client';

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAuth', () => {
  describe('loading state', () => {
    it('returns isLoading true when session is loading', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: 'loading',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('returns isLoading false when session is loaded', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('authenticated state', () => {
    it('returns isAuthenticated true when status is authenticated', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
            image: 'https://example.com/avatar.jpg',
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it('returns isAuthenticated false when status is unauthenticated', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('user data extraction', () => {
    it('returns user data when authenticated', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-123',
            name: 'John Doe',
            email: 'john@example.com',
            image: 'https://example.com/john.jpg',
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.user).toMatchObject({
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        image: 'https://example.com/john.jpg',
        role: 'USER',
      });
    });

    it('returns null user when unauthenticated', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.user).toBeNull();
    });

    it('handles null name in user object', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-456',
            name: null,
            email: 'test@example.com',
            image: null,
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.user?.name).toBeNull();
      expect(result.current.user?.image).toBeNull();
    });

    it('handles undefined name as null', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-789',
            name: undefined,
            email: 'test@example.com',
            image: undefined,
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.user?.name).toBeNull();
      expect(result.current.user?.image).toBeNull();
    });
  });

  describe('signIn', () => {
    it('calls nextAuthSignIn with correct callback URL', () => {
      const mockSignIn = vi.fn();
      vi.mocked(nextAuthReact.signIn).mockImplementation(mockSignIn);

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      act(() => {
        result.current.signIn();
      });

      expect(mockSignIn).toHaveBeenCalledWith(undefined, { callbackUrl: '/dashboard' });
    });

  });

  describe('signOut', () => {
    it('calls nextAuthSignOut with correct callback URL', () => {
      const mockSignOut = vi.fn();
      vi.mocked(nextAuthReact.signOut).mockImplementation(mockSignOut);

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
            image: null,
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      act(() => {
        result.current.signOut();
      });

      expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/' });
    });

  });

  describe('impersonation', () => {
    it('exposes impersonate and stopImpersonating methods', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'admin-1',
            name: 'Admin',
            email: 'admin@example.com',
            image: null,
            role: 'ADMIN' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(typeof result.current.impersonate).toBe('function');
      expect(typeof result.current.stopImpersonating).toBe('function');
    });

    it('calls session update with impersonateUserId', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({});
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'admin-1',
            name: 'Admin',
            email: 'admin@example.com',
            image: null,
            role: 'ADMIN' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: mockUpdate,
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.impersonate('sotto-id');
      });

      expect(mockUpdate).toHaveBeenCalledWith({ impersonateUserId: 'sotto-id' });
    });

    it('calls session update with stopImpersonating', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({});
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'sotto-id',
            name: 'Sotto',
            email: 'sotto@sotto.fm',
            image: null,
            role: 'ADMIN' as UserRole,
            isImpersonating: true,
            originalUser: { id: 'admin-1', name: 'Admin', image: null },
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: mockUpdate,
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.stopImpersonating();
      });

      expect(mockUpdate).toHaveBeenCalledWith({ stopImpersonating: true });
    });

    it('includes impersonation fields in user object', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'sotto-id',
            name: 'Sotto',
            email: 'sotto@sotto.fm',
            image: null,
            role: 'ADMIN' as UserRole,
            isImpersonating: true,
            impersonatedRole: 'USER' as UserRole,
            originalUser: { id: 'admin-1', name: 'Admin', image: null },
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.user?.isImpersonating).toBe(true);
      expect(result.current.user?.impersonatedRole).toBe('USER');
      expect(result.current.user?.originalUser).toEqual({
        id: 'admin-1',
        name: 'Admin',
        image: null,
      });
    });
  });

  describe('session updates', () => {
    it('updates when session changes from unauthenticated to authenticated', () => {
      const { rerender } = renderHook(() => useAuth());

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: vi.fn(),
      });

      rerender();
      const { result } = renderHook(() => useAuth());

      expect(result.current.isAuthenticated).toBe(false);

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-1',
            name: 'New User',
            email: 'new@example.com',
            image: null,
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result: result2 } = renderHook(() => useAuth());
      expect(result2.current.isAuthenticated).toBe(true);
      expect(result2.current.user?.email).toBe('new@example.com');
    });

    it('updates when session expires', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
            image: null,
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { rerender } = renderHook(() => useAuth());
      const { result } = renderHook(() => useAuth());

      expect(result.current.isAuthenticated).toBe(true);

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: vi.fn(),
      });

      rerender();
      const { result: result2 } = renderHook(() => useAuth());
      expect(result2.current.isAuthenticated).toBe(false);
      expect(result2.current.user).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles missing email gracefully', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-1',
            name: 'Test User',
            email: null,
            image: null,
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.user?.email).toBeNull();
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('handles session with minimal user data', () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          user: {
            id: 'user-minimal',
            role: 'USER' as UserRole,
          },
          expires: '2025-01-01',
        },
        status: 'authenticated',
        update: vi.fn(),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.user).toMatchObject({
        id: 'user-minimal',
        name: null,
        email: null,
        image: null,
        role: 'USER',
      });
    });
  });
});
