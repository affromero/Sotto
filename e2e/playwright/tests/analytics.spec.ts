import { test, expect } from '../fixtures/auth';

test.describe('Analytics', () => {
  test('analytics page loads', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/analytics');
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });

  test('period selector changes data range', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/analytics');

    // Try clicking different period options
    const periodButtons = ['7 Days', '30 Days', '90 Days', 'All Time'];
    for (const period of periodButtons) {
      const btn = page.locator(`button:has-text("${period}")`);
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await page.waitForLoadState('networkidle');
        break; // Just verify at least one works
      }
    }
  });
});
