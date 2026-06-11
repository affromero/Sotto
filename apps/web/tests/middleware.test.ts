/**
 * Middleware Security Tests
 *
 * Tests route protection, auth redirects, admin privilege escalation,
 * and public route accessibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock next-auth/jwt
const mockGetToken = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

const TEST_SECRET = 'test-secret-for-middleware-tests-32ch';

function createRequest(path: string): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  return new NextRequest(url);
}

function getRedirectLocation(response: Response): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  try {
    return new URL(location).pathname;
  } catch {
    return location;
  }
}

function isPassThrough(response: Response): boolean {
  return !response.headers.get('location');
}

// Lazy-import middleware after mocks are set up
async function getMiddleware() {
  const mod = await import('@/middleware');
  return mod.middleware;
}

describe('Middleware Security Tests', () => {
  let middleware: Awaited<ReturnType<typeof getMiddleware>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.AUTH_SECRET = TEST_SECRET;
    mockGetToken.mockResolvedValue(null);
    middleware = await getMiddleware();
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  // =====================================================================
  // PATH TRAVERSAL — Trying to sneak past route checks
  // =====================================================================
  describe('Path Traversal & URL Tricks', () => {
    it('redirects /dashboard/ to login (trailing slash)', async () => {
      const res = await middleware(createRequest('/dashboard/'));
      expect(getRedirectLocation(res)).toBe('/auth/login');
    });

    it('redirects /admin/secret-page to login', async () => {
      const res = await middleware(createRequest('/admin/secret-page'));
      expect(getRedirectLocation(res)).toBe('/auth/login');
    });

    it('redirects /welcome to login', async () => {
      const res = await middleware(createRequest('/welcome'));
      expect(getRedirectLocation(res)).toBe('/auth/login');
    });
  });

  // =====================================================================
  // PUBLIC ROUTES — Always accessible without auth
  // =====================================================================
  describe('Public Routes — Always Accessible', () => {
    const publicPaths = [
      '/',
      '/api/v1/health',
      '/feedback',
      '/api/v1/feedback',
      '/pitch',
    ];

    for (const path of publicPaths) {
      it(`allows ${path} without auth`, async () => {
        const res = await middleware(createRequest(path));
        expect(isPassThrough(res)).toBe(true);
      });
    }

    it('allows /api/v1/auth/providers (public prefix)', async () => {
      const res = await middleware(createRequest('/api/v1/auth/providers'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows /api/v1/auth/callback/google (public prefix)', async () => {
      const res = await middleware(createRequest('/api/v1/auth/callback/google'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows /api/v1/pitch/manifest (public prefix)', async () => {
      const res = await middleware(createRequest('/api/v1/pitch/manifest'));
      expect(isPassThrough(res)).toBe(true);
    });

  });

  // =====================================================================
  // STATIC FILES — Always skipped
  // =====================================================================
  describe('Static Files — Always Skipped', () => {
    const staticPaths = [
      '/_next/static/chunks/main.js',
      '/_next/image?url=test',
      '/favicon.ico',
      '/fonts/inter.woff2',
    ];

    for (const path of staticPaths) {
      it(`passes through ${path}`, async () => {
        const res = await middleware(createRequest(path));
        expect(isPassThrough(res)).toBe(true);
      });
    }
  });

  // =====================================================================
  // AUTH LAYER — Route protection and redirects
  // =====================================================================
  describe('Auth Layer', () => {
    it('redirects unauthenticated user from /dashboard to /auth/login', async () => {
      const res = await middleware(createRequest('/dashboard'));
      expect(getRedirectLocation(res)).toBe('/auth/login');
    });

    it('includes callbackUrl when redirecting to login', async () => {
      const res = await middleware(createRequest('/create'));
      const fullLocation = res.headers.get('location')!;
      expect(fullLocation).toContain('callbackUrl=%2Fcreate');
    });

    it('/auth/login redirects authenticated users to /learn', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(createRequest('/auth/login'));
      expect(getRedirectLocation(res)).toBe('/learn');
    });

    it('/auth/signup redirects authenticated users to /learn', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(createRequest('/auth/signup'));
      expect(getRedirectLocation(res)).toBe('/learn');
    });

    it('allows authenticated user to access /dashboard', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(createRequest('/dashboard'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows authenticated user to access /create', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(createRequest('/create'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('passes through API routes (own auth handling)', async () => {
      const res = await middleware(createRequest('/api/v1/podcasts'));
      // API routes without Authorization header still need to reach the API handler
      // They pass through because they're not in PROTECTED_ROUTES check (starts with /api/v1/)
      expect(isPassThrough(res)).toBe(true);
    });

    it('passes through public feedback route', async () => {
      const res = await middleware(createRequest('/feedback'));
      expect(isPassThrough(res)).toBe(true);
    });
  });

  // =====================================================================
  // ADMIN PRIVILEGE ESCALATION — Trying to access /admin without role
  // =====================================================================
  describe('Admin Privilege Escalation', () => {
    it('blocks regular USER from /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(createRequest('/admin'));
      expect(getRedirectLocation(res)).toBe('/learn');
    });

    it('blocks user with no role from /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-3' });
      const res = await middleware(createRequest('/admin'));
      expect(getRedirectLocation(res)).toBe('/learn');
    });

    it('blocks user with fabricated role string from /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-4', role: 'SUPERADMIN' });
      const res = await middleware(createRequest('/admin'));
      expect(getRedirectLocation(res)).toBe('/learn');
    });

    it('allows ADMIN to access /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'admin-1', role: 'ADMIN' });
      const res = await middleware(createRequest('/admin'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows ADMIN to access /admin/users', async () => {
      mockGetToken.mockResolvedValue({ sub: 'admin-1', role: 'ADMIN' });
      const res = await middleware(createRequest('/admin/users'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('blocks USER from /admin/users subpath', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(createRequest('/admin/users'));
      expect(getRedirectLocation(res)).toBe('/learn');
    });
  });
});
