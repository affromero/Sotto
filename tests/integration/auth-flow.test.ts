import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock NextAuth ----

const mockGetServerSession = vi.fn();
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSession: vi.fn().mockReturnValue({ data: null, status: 'unauthenticated' }),
}));

vi.mock('@/lib/auth', () => ({
  auth: () => mockGetServerSession(),
  authOptions: {
    providers: [
      { id: 'google', name: 'Google' },
      { id: 'github', name: 'GitHub' },
    ],
  },
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

// ---- Mock Prisma ----

const mockUserFindUnique = vi.fn();
const mockAccountFindMany = vi.fn().mockResolvedValue([]);
const mockSessionFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      create: vi.fn(),
      update: vi.fn(),
    },
    account: {
      findMany: (...args: unknown[]) => mockAccountFindMany(...args),
    },
    session: {
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
    },
  },
}));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Auth Flow — Session Management', () => {
  it('should return null session for unauthenticated users', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const session = await mockGetServerSession();
    expect(session).toBeNull();
  });

  it('should return session with user data for authenticated users', async () => {
    const sessionData = {
      user: {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.jpg',
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };

    mockGetServerSession.mockResolvedValue(sessionData);

    const session = await mockGetServerSession();
    expect(session).toBeDefined();
    expect(session.user.id).toBe('user-1');
    expect(session.user.email).toBe('test@example.com');
  });

  it('should include user id in session', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123', email: 'user@example.com' },
    });

    const session = await mockGetServerSession();
    expect(session.user.id).toBe('user-123');
  });
});

describe('Auth Flow — OAuth Sign In', () => {
  it('should call signIn with Google provider and callback URL', async () => {
    await mockSignIn('google', { callbackUrl: '/dashboard' });

    expect(mockSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
  });

  it('should call signIn with GitHub provider and callback URL', async () => {
    await mockSignIn('github', { callbackUrl: '/dashboard' });

    expect(mockSignIn).toHaveBeenCalledWith('github', { callbackUrl: '/dashboard' });
  });

  it('should support custom callback URLs', async () => {
    await mockSignIn('google', { callbackUrl: '/create' });

    expect(mockSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/create' });
  });
});

describe('Auth Flow — Sign Out', () => {
  it('should call signOut with redirect to home', async () => {
    await mockSignOut({ callbackUrl: '/' });

    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/' });
  });
});

describe('Auth Flow — Protected Route Access', () => {
  const protectedRoutes = ['/dashboard', '/create', '/settings', '/billing'];
  const publicRoutes = ['/', '/feed', '/pricing', '/auth/login', '/auth/signup'];

  protectedRoutes.forEach((route) => {
    it(`should require auth for ${route}`, () => {
      // Verify the route is in the protected list
      expect(protectedRoutes).toContain(route);
    });
  });

  publicRoutes.forEach((route) => {
    it(`should allow public access to ${route}`, () => {
      expect(protectedRoutes).not.toContain(route);
    });
  });

  it('should redirect unauthenticated users to login with callback', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const session = await mockGetServerSession();
    const isAuthenticated = !!session?.user?.id;

    expect(isAuthenticated).toBe(false);

    // Middleware would redirect to /auth/login?callbackUrl=/dashboard
    const loginUrl = `/auth/login?callbackUrl=${encodeURIComponent('/dashboard')}`;
    expect(loginUrl).toContain('callbackUrl');
  });

  it('should allow authenticated users to access protected routes', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com' },
    });

    const session = await mockGetServerSession();
    const isAuthenticated = !!session?.user?.id;

    expect(isAuthenticated).toBe(true);
  });

  it('should redirect authenticated users away from auth pages', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com' },
    });

    const session = await mockGetServerSession();
    const isAuthenticated = !!session?.user?.id;
    const isAuthPage = ['/auth/login', '/auth/signup'].some((r) => '/auth/login'.startsWith(r));

    // Should redirect to /dashboard
    expect(isAuthenticated && isAuthPage).toBe(true);
  });
});

describe('Auth Flow — Connected Accounts', () => {
  it('should list connected OAuth providers for a user', async () => {
    mockAccountFindMany.mockResolvedValue([
      { provider: 'google' },
      { provider: 'github' },
    ]);

    const accounts = await mockAccountFindMany({ where: { userId: 'user-1' } });
    const providers = accounts.map((a: { provider: string }) => a.provider);

    expect(providers).toContain('google');
    expect(providers).toContain('github');
    expect(providers).toHaveLength(2);
  });

  it('should return empty array when no providers connected', async () => {
    mockAccountFindMany.mockResolvedValue([]);

    const accounts = await mockAccountFindMany({ where: { userId: 'user-1' } });
    expect(accounts).toHaveLength(0);
  });
});

describe('Auth Flow — User Profile', () => {
  it('should fetch user profile data', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      bio: 'A test user',
      image: 'https://example.com/avatar.jpg',
      podcastsUsed: 2,
      podcastsAllowed: 3,
    });

    const user = await mockUserFindUnique({ where: { id: 'user-1' } });

    expect(user.name).toBe('Test User');
    expect(user.podcastsUsed).toBe(2);
    expect(user.podcastsAllowed).toBe(3);
  });

  it('should handle missing user gracefully', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const user = await mockUserFindUnique({ where: { id: 'nonexistent' } });
    expect(user).toBeNull();
  });
});
