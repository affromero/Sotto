import { test, expect } from '@playwright/test';

const protectedRoutes: { method: 'get' | 'post' | 'patch' | 'delete'; path: string }[] = [
  { method: 'get', path: '/api/v1/podcasts' },
  { method: 'get', path: '/api/v1/notifications' },
  { method: 'get', path: '/api/v1/keys' },
  { method: 'patch', path: '/api/v1/users/me' },
  { method: 'get', path: '/api/v1/users/me/podcasts' },
  { method: 'post', path: '/api/v1/podcasts/e2e-podcast/interact' },
];

test.describe('Auth guards — 401 without session', () => {
  for (const route of protectedRoutes) {
    test(`${route.method.toUpperCase()} ${route.path} returns 401`, async ({ request }) => {
      const res = await request[route.method](route.path);
      expect(res.status()).toBe(401);
    });
  }
});
