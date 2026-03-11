import { test as base, type BrowserContext } from '@playwright/test';
import { seedTestUser } from '../helpers/seed';

/**
 * Auth fixture for Playwright tests.
 *
 * Seeds a test user in the DB and sets a NextAuth-compatible session cookie
 * directly on the browser context. This avoids driving OAuth flows in tests.
 *
 * The JWT is generated using the same NEXTAUTH_SECRET the dev server uses.
 */

// Store seed data at module level so it's shared across fixtures
let seedData: Awaited<ReturnType<typeof seedTestUser>> | null = null;

async function getSeedData() {
  if (!seedData) {
    seedData = await seedTestUser();
  }
  return seedData;
}

export const test = base.extend<{
  authedContext: BrowserContext;
  seedData: Awaited<ReturnType<typeof seedTestUser>>;
}>({
  seedData: async ({}, use) => {
    const data = await getSeedData();
    await use(data);
  },
  authedContext: async ({ browser }, use) => {
    const { sessionToken } = await getSeedData();
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: 'authjs.session-token',
        value: sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
