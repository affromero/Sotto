/**
 * Middleware Security Tests — "Evil Agent"
 *
 * These tests simulate an attacker trying to bypass the password gate,
 * access protected routes without auth, escalate privileges, and exploit
 * edge cases in URL parsing and cookie verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

// Mock next-auth/jwt
const mockGetToken = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

const TEST_SECRET = 'test-secret-for-middleware-tests-32ch';
const TEST_SITE_PASSWORD = 'alpha-secret-123';

function createRequest(path: string, options?: { cookies?: Record<string, string> }): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  const req = new NextRequest(url);
  if (options?.cookies) {
    for (const [name, value] of Object.entries(options.cookies)) {
      req.cookies.set(name, value);
    }
  }
  return req;
}

async function createValidAccessCookie(secret: string, timestamp?: number): Promise<string> {
  const ts = (timestamp ?? Date.now()).toString();
  const hmac = crypto.createHmac('sha256', secret).update(ts).digest('hex');
  return `${ts}:${hmac}`;
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
  // NextResponse.next() returns a response without a redirect location
  return !response.headers.get('location');
}

// Lazy-import middleware after mocks are set up
async function getMiddleware() {
  const mod = await import('@/middleware');
  return mod.middleware;
}

describe('Middleware — Evil Agent Security Tests', () => {
  let middleware: Awaited<ReturnType<typeof getMiddleware>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // Default: password gate enabled
    process.env.SITE_PASSWORD = TEST_SITE_PASSWORD;
    process.env.NEXTAUTH_SECRET = TEST_SECRET;
    mockGetToken.mockResolvedValue(null);
    middleware = await getMiddleware();
  });

  afterEach(() => {
    delete process.env.SITE_PASSWORD;
    delete process.env.NEXTAUTH_SECRET;
  });

  // =====================================================================
  // PASSWORD GATE — Trying to access the app without the secret URL
  // =====================================================================
  describe('Password Gate — Stealth', () => {
    it('redirects / to pass through (under construction is public)', async () => {
      const res = await middleware(createRequest('/'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('silently redirects /dashboard to / (hides gate existence)', async () => {
      const res = await middleware(createRequest('/dashboard'));
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('/auth/login passes through as a public route', async () => {
      const res = await middleware(createRequest('/auth/login'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('silently redirects /feed to / (hides gate existence)', async () => {
      const res = await middleware(createRequest('/feed'));
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('silently redirects /create to / (hides gate existence)', async () => {
      const res = await middleware(createRequest('/create'));
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('/romero passes through as a public route', async () => {
      const res = await middleware(createRequest('/romero'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('redirects /romero subpaths to / (not in PUBLIC_ROUTES)', async () => {
      const res = await middleware(createRequest('/romero/settings'));
      expect(getRedirectLocation(res)).toBe('/');
    });
  });

  // =====================================================================
  // PASSWORD GATE — Cookie forgery and tampering
  // =====================================================================
  describe('Password Gate — Cookie Attacks', () => {
    it('rejects a completely fabricated cookie', async () => {
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: 'hacked' } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie with valid timestamp but wrong signature', async () => {
      const fakeCookie = `${Date.now()}:deadbeefcafebabe1234567890abcdef`;
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: fakeCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie signed with the wrong secret', async () => {
      const wrongCookie = await createValidAccessCookie('wrong-secret');
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: wrongCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie with timestamp in the future', async () => {
      const futureTs = Date.now() + 1000 * 60 * 60 * 24; // 24h in the future
      const futureCookie = await createValidAccessCookie(TEST_SECRET, futureTs);
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: futureCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie older than 1 hour (expired)', async () => {
      const expiredTs = Date.now() - 1000 * 60 * 61; // 61 minutes ago
      const expiredCookie = await createValidAccessCookie(TEST_SECRET, expiredTs);
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: expiredCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('accepts a cookie that is 59 minutes old (still valid)', async () => {
      const recentTs = Date.now() - 1000 * 60 * 59; // 59 minutes ago
      const validCookie = await createValidAccessCookie(TEST_SECRET, recentTs);
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(
        createRequest('/auth/login', { cookies: { sotto_access: validCookie } })
      );
      // Should pass the gate (then hit auth logic, not redirect to /)
      expect(getRedirectLocation(res)).not.toBe('/');
    });

    it('rejects an empty cookie value', async () => {
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: '' } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie with no separator', async () => {
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: 'noseparator' } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie with multiple separators (injection attempt)', async () => {
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: '123:abc:def:ghi' } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie with non-numeric timestamp', async () => {
      const res = await middleware(
        createRequest('/dashboard', {
          cookies: { sotto_access: 'not-a-number:abcdef1234' },
        })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects a cookie with negative timestamp', async () => {
      const negativeCookie = await createValidAccessCookie(TEST_SECRET, -1);
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: negativeCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects when NEXTAUTH_SECRET is not set', async () => {
      delete process.env.NEXTAUTH_SECRET;
      // Re-import to pick up env change
      vi.resetModules();
      const { middleware: mw } = await import('@/middleware');
      const validCookie = await createValidAccessCookie(TEST_SECRET);
      const res = await mw(
        createRequest('/dashboard', { cookies: { sotto_access: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('accepts a freshly created valid cookie', async () => {
      const validCookie = await createValidAccessCookie(TEST_SECRET);
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(
        createRequest('/auth/login', { cookies: { sotto_access: validCookie } })
      );
      // Passes the gate — ends up at auth logic, NOT redirected to /
      expect(getRedirectLocation(res)).not.toBe('/');
    });
  });

  // =====================================================================
  // PATH TRAVERSAL — Trying to sneak past route checks
  // =====================================================================
  describe('Path Traversal & URL Tricks', () => {
    it('blocks /dashboard/ (trailing slash)', async () => {
      const res = await middleware(createRequest('/dashboard/'));
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('blocks /admin/secret-page', async () => {
      const res = await middleware(createRequest('/admin/secret-page'));
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('blocks /settings/voices', async () => {
      const res = await middleware(createRequest('/settings/voices'));
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('blocks /billing/checkout', async () => {
      const res = await middleware(createRequest('/billing/checkout'));
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('blocks /onboarding', async () => {
      const res = await middleware(createRequest('/onboarding'));
      expect(getRedirectLocation(res)).toBe('/');
    });
  });

  // =====================================================================
  // PUBLIC ROUTES — Should always be accessible, even with gate on
  // =====================================================================
  describe('Public Routes — Always Accessible', () => {
    const publicPaths = [
      '/',
      '/api/access',
      '/api/health',
      '/api/waitlist',
      '/feedback',
      '/api/feedback',
      '/pitch',
    ];

    for (const path of publicPaths) {
      it(`allows ${path} without any cookies`, async () => {
        const res = await middleware(createRequest(path));
        expect(isPassThrough(res)).toBe(true);
      });
    }

    it('allows /api/auth/providers (public prefix)', async () => {
      const res = await middleware(createRequest('/api/auth/providers'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows /api/auth/callback/google (public prefix)', async () => {
      const res = await middleware(createRequest('/api/auth/callback/google'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows /api/pitch/manifest (public prefix)', async () => {
      const res = await middleware(createRequest('/api/pitch/manifest'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows /api/oembed (public prefix)', async () => {
      const res = await middleware(createRequest('/api/oembed'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows /podcast/abc123/embed (embed bypass)', async () => {
      const res = await middleware(createRequest('/podcast/abc123/embed'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('does NOT allow /podcast/abc123/embed/evil (must match exact pattern)', async () => {
      const res = await middleware(createRequest('/podcast/abc123/embed/evil'));
      // Not a public route, so gate applies
      expect(getRedirectLocation(res)).toBe('/');
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
  // AUTH — With valid password gate cookie, test auth layer
  // =====================================================================
  describe('Auth Layer — After Password Gate', () => {
    let validCookie: string;

    beforeEach(async () => {
      validCookie = await createValidAccessCookie(TEST_SECRET);
    });

    it('redirects unauthenticated user from /dashboard to /auth/login', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: validCookie } })
      );
      const location = getRedirectLocation(res);
      expect(location).toBe('/auth/login');
    });

    it('includes callbackUrl when redirecting to login', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(
        createRequest('/create', { cookies: { sotto_access: validCookie } })
      );
      const fullLocation = res.headers.get('location')!;
      expect(fullLocation).toContain('callbackUrl=%2Fcreate');
    });

    it('/auth/login passes through as public (even with cookie)', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(
        createRequest('/auth/login', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });

    it('/auth/signup passes through as public (even with cookie)', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(
        createRequest('/auth/signup', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows authenticated user to access /dashboard', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows authenticated user to access /create', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(
        createRequest('/create', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });

    it('passes through API routes after gate (own auth handling)', async () => {
      const res = await middleware(
        createRequest('/api/podcasts', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });

    it('passes through non-protected, non-auth routes after gate', async () => {
      const res = await middleware(
        createRequest('/feed', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });
  });

  // =====================================================================
  // ADMIN PRIVILEGE ESCALATION — Trying to access /admin without role
  // =====================================================================
  describe('Admin Privilege Escalation', () => {
    let validCookie: string;

    beforeEach(async () => {
      validCookie = await createValidAccessCookie(TEST_SECRET);
    });

    it('blocks regular USER from /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(
        createRequest('/admin', { cookies: { sotto_access: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/dashboard');
    });

    it('blocks CREATOR from /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-2', role: 'CREATOR' });
      const res = await middleware(
        createRequest('/admin', { cookies: { sotto_access: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/dashboard');
    });

    it('blocks user with no role from /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-3' });
      const res = await middleware(
        createRequest('/admin', { cookies: { sotto_access: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/dashboard');
    });

    it('blocks user with fabricated role string from /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-4', role: 'SUPERADMIN' });
      const res = await middleware(
        createRequest('/admin', { cookies: { sotto_access: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/dashboard');
    });

    it('allows ADMIN to access /admin', async () => {
      mockGetToken.mockResolvedValue({ sub: 'admin-1', role: 'ADMIN' });
      const res = await middleware(
        createRequest('/admin', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });

    it('allows ADMIN to access /admin/users', async () => {
      mockGetToken.mockResolvedValue({ sub: 'admin-1', role: 'ADMIN' });
      const res = await middleware(
        createRequest('/admin/users', { cookies: { sotto_access: validCookie } })
      );
      expect(isPassThrough(res)).toBe(true);
    });

    it('blocks USER from /admin/users subpath', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(
        createRequest('/admin/users', { cookies: { sotto_access: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/dashboard');
    });
  });

  // =====================================================================
  // NO PASSWORD GATE — When SITE_PASSWORD is not set
  // =====================================================================
  describe('No Password Gate (SITE_PASSWORD unset)', () => {
    beforeEach(() => {
      delete process.env.SITE_PASSWORD;
    });

    it('allows /romero without password', async () => {
      const res = await middleware(createRequest('/romero'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('redirects unauthenticated user from /dashboard to login (auth still works)', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(createRequest('/dashboard'));
      expect(getRedirectLocation(res)).toBe('/auth/login');
    });

    it('allows authenticated user to access /dashboard', async () => {
      mockGetToken.mockResolvedValue({ sub: 'user-1', role: 'USER' });
      const res = await middleware(createRequest('/dashboard'));
      expect(isPassThrough(res)).toBe(true);
    });
  });

  // =====================================================================
  // CROSS-COOKIE CONFUSION — Using pitch cookie for access gate
  // =====================================================================
  describe('Cross-Cookie Confusion', () => {
    it('rejects sotto_pitch cookie used for access gate', async () => {
      const validCookie = await createValidAccessCookie(TEST_SECRET);
      const res = await middleware(
        createRequest('/dashboard', { cookies: { sotto_pitch: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });

    it('rejects random cookie names with valid token format', async () => {
      const validCookie = await createValidAccessCookie(TEST_SECRET);
      const res = await middleware(
        createRequest('/dashboard', { cookies: { session: validCookie } })
      );
      expect(getRedirectLocation(res)).toBe('/');
    });
  });
});
