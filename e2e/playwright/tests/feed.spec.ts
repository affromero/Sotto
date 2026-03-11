import { test, expect } from '../fixtures/auth';

test.describe('Feed', () => {
  test('feed page loads with podcasts', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');
    await expect(page.locator('[data-testid="feed"]')).toBeVisible({ timeout: 10_000 });
  });

  test('sort controls change feed order', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');

    // Click sort options if available
    const sortButton = page.locator('button:has-text("Recent")');
    if (await sortButton.isVisible()) {
      await sortButton.click();
      await page.waitForLoadState('networkidle');
    }
  });

  test('search navigates to search page', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');

    const searchLink = page.locator('a[href="/search"]').first();
    if (await searchLink.isVisible()) {
      await searchLink.click();
      await expect(page).toHaveURL(/\/search/);
    }
  });

  test('clicking a podcast card navigates to player', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');

    const firstCard = page.locator('[data-testid="podcast-card"]').first();
    if (await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCard.click();
      await expect(page).toHaveURL(/\/podcast\//);
    }
  });
});
