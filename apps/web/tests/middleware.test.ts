/**
 * Middleware tests
 *
 * Sotto is fully self-hosted with no login, so the middleware does no auth
 * gating. It only (a) skips static/SEO assets and (b) steers the managed
 * showcase (SELF_HOSTED=false) into its /welcome demo. Real self-hosted
 * installs pass every request through.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

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

async function getMiddleware() {
  const mod = await import('@/middleware');
  return mod.middleware;
}

describe('Middleware', () => {
  let middleware: Awaited<ReturnType<typeof getMiddleware>>;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.SELF_HOSTED;
    middleware = await getMiddleware();
  });

  afterEach(() => {
    delete process.env.SELF_HOSTED;
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
        const res = await middleware(createRequest(path));
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
        const res = await middleware(createRequest(path));
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
      '/invite/code_123',
      '/ref/alice',
    ];

    for (const path of mockRoutes) {
      it(`redirects ${path} to the /welcome demo`, async () => {
        const res = await middleware(createRequest(path));
        expect(getRedirectLocation(res)).toBe('/welcome');
      });
    }

    it('lets /welcome itself render the demo', async () => {
      const res = await middleware(createRequest('/welcome'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('does not redirect the public landing page', async () => {
      const res = await middleware(createRequest('/'));
      expect(isPassThrough(res)).toBe(true);
    });

    it('does not redirect the public health route', async () => {
      const res = await middleware(createRequest('/api/v1/health'));
      expect(isPassThrough(res)).toBe(true);
    });
  });
});
