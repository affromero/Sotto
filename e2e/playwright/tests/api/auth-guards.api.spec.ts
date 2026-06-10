import { test, expect } from '@playwright/test';

const protectedRoutes: { method: 'get' | 'post' | 'patch' | 'delete'; path: string }[] = [
  { method: 'get', path: '/api/podcasts' },
  { method: 'get', path: '/api/notifications' },
  { method: 'get', path: '/api/ideas' },
  { method: 'get', path: '/api/keys' },
  { method: 'get', path: '/api/saved' },
  { method: 'get', path: '/api/picks' },
  { method: 'patch', path: '/api/users/me' },
  { method: 'post', path: '/api/drafts' },
  { method: 'post', path: '/api/podcasts/e2e-podcast/interact' },
];

test.describe('Auth guards — 401 without session', () => {
  for (const route of protectedRoutes) {
    test(`${route.method.toUpperCase()} ${route.path} returns 401`, async ({ request }) => {
      const res = await request[route.method](route.path);
      expect(res.status()).toBe(401);
    });
  }
});
