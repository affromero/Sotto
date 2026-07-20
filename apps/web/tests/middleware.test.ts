/**
 * Proxy tests
 *
 * Sotto is self-hosted with an optional hard access gate. The proxy protects
 * pages and API routes when that gate is configured, skips static/SEO assets,
 * and steers the managed showcase into its /welcome demo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

function createRequest(
  path: string,
  cookie?: string,
  headers?: Record<string, string>
): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  return new NextRequest(url, {
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
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

async function getProxy() {
  const mod = await import('@/proxy');
  return mod.proxy;
}

describe('Proxy', () => {
  let proxy: Awaited<ReturnType<typeof getProxy>>;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.SELF_HOSTED;
    delete process.env.SOTTO_ACCESS_PASSWORD;
    proxy = await getProxy();
  });

  afterEach(() => {
    delete process.env.SELF_HOSTED;
    delete process.env.SOTTO_ACCESS_PASSWORD;
  });

  describe('Static and SEO assets pass through', () => {
    const staticPaths = [
      '/_next/static/chunks/main.js',
      '/_next/image?url=test',
      '/favicon.ico',
      '/fonts/inter.woff2',
      '/sitemap.xml',
      '/robots.txt',
    ];

    for (const path of staticPaths) {
      it(`passes through ${path}`, async () => {
        const res = await proxy(createRequest(path));
        expect(isPassThrough(res)).toBe(true);
      });
    }
  });

  describe('Self-hosted: no login, everything passes through', () => {
    const paths = [
      '/',
      '/dashboard',
      '/dashboard/',
      '/admin',
      '/admin/users',
      '/create',
      '/settings',
      '/learn',
      '/welcome',
      '/episode/ep_1',
      '/api/v1/health',
      '/api/v1/episodes',
    ];

    for (const path of paths) {
      it(`passes through ${path} with no auth redirect`, async () => {
        const res = await proxy(createRequest(path));
        expect(isPassThrough(res)).toBe(true);
      });
    }
  });

  describe('Managed showcase (SELF_HOSTED=false)', () => {
    beforeEach(() => {
      process.env.SELF_HOSTED = 'false';
    });

    const mockRoutes = [
      '/dashboard',
      '/admin',
      '/admin/users',
      '/learn',
      '/create',
      '/settings',
      '/memory',
      '/profile',
      '/voices',
      '/classes/class_1/worksheet',
      '/episode/ep_1',
      '/ref/alice',
    ];

    for (const path of mockRoutes) {
      it(`redirects ${path} to the /welcome demo`, async () => {
        const res = await proxy(createRequest(path));
        expect(getRedirectLocation(res)).toBe('/welcome');
      });
    }

    it('lets /welcome itself render the demo', async () => {
      const res = await proxy(createRequest('/welcome'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('does not redirect the public landing page', async () => {
      const res = await proxy(createRequest('/'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('does not redirect the public health route', async () => {
      const res = await proxy(createRequest('/api/v1/health'));
      expect(isPassThrough(res)).toBe(true);
    });
  });

  describe('Access gate (SOTTO_ACCESS_PASSWORD set)', () => {
    beforeEach(() => {
      process.env.SOTTO_ACCESS_PASSWORD = 'family-secret';
      process.env.BYOK_ENCRYPTION_KEY = 'test-signing-key-material-0123456789abcdef';
    });

    const gatedPages = ['/', '/dashboard', '/profiles', '/welcome', '/settings', '/invite'];
    for (const path of gatedPages) {
      it(`redirects ${path} to /gate without a gate cookie`, async () => {
        const res = await proxy(createRequest(path));
        expect(getRedirectLocation(res)).toBe('/gate');
      });
    }

    const exemptPaths = [
      '/gate',
      '/api/v1/health',
      '/api/v1/gate',
      '/icon.svg',
      '/icon-192.png',
      '/apple-icon.png',
      '/apple-touch-icon.png',
      '/favicon.ico',
    ];
    for (const path of exemptPaths) {
      it(`never gate-redirects ${path}`, async () => {
        const res = await proxy(createRequest(path));
        expect(getRedirectLocation(res)).not.toBe('/gate');
      });
    }

    it('rejects a forged gate cookie', async () => {
      const res = await proxy(createRequest('/dashboard', 'sotto_gate=123.deadbeef'));
      expect(getRedirectLocation(res)).toBe('/gate');
    });

    it('passes through with a valid gate cookie', async () => {
      const { createGateToken } = await import('@/lib/access/gate');
      const token = await createGateToken();
      const res = await proxy(createRequest('/dashboard', `sotto_gate=${token}`));
      expect(isPassThrough(res)).toBe(true);
    });

    it('returns 401 for a protected API without a gate cookie', async () => {
      const res = await proxy(createRequest('/api/v1/keys'));
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 for a protected API with a forged gate cookie', async () => {
      const res = await proxy(createRequest('/api/v1/keys', 'sotto_gate=123.deadbeef'));
      expect(res.status).toBe(401);
    });

    it('passes a protected API through with a valid gate cookie', async () => {
      const { createGateToken } = await import('@/lib/access/gate');
      const token = await createGateToken();
      const res = await proxy(createRequest('/api/v1/keys', `sotto_gate=${token}`));
      expect(isPassThrough(res)).toBe(true);
      expect(res.status).toBe(200);
    });

    it('passes bearer requests to handlers for full API-key validation', async () => {
      const res = await proxy(
        createRequest('/api/v1/episodes', undefined, {
          authorization: 'Bearer sk_sotto_candidate',
        })
      );
      expect(isPassThrough(res)).toBe(true);
      expect(res.status).toBe(200);
    });

    it('is inert when no password is configured', async () => {
      delete process.env.SOTTO_ACCESS_PASSWORD;
      const res = await proxy(createRequest('/dashboard'));
      expect(isPassThrough(res)).toBe(true);
    });
  });
});
