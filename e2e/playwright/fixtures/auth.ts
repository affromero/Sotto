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
export const test = base.extend<{ authedContext: BrowserContext }>({
  authedContext: async ({ browser }, use) => {
    // Seed user and get session token
    const { sessionToken } = await seedTestUser();

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
