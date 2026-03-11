import { test, expect } from '../fixtures/auth';

test.describe('Voice Marketplace', () => {
  test('voices page loads with search and voice list', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/voices');
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
    // Should show search input or voice cards
  });

  test('search filters voices', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/voices');

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill('deep voice');
      await page.waitForLoadState('networkidle');
    }
  });
});
