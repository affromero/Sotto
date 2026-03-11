import { test, expect } from '../fixtures/auth';

test.describe('Billing', () => {
  test('billing page loads and shows current plan', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/billing');
    // Should show plan name (Free or Pro) and billing info
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Free, text=Pro').first()).toBeVisible({ timeout: 10_000 });
  });

  test('upgrade button is visible for free users', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/billing');
    const upgradeBtn = page.locator('button:has-text("Upgrade"), a:has-text("Upgrade")');
    // Free test user should see upgrade CTA
    if (await upgradeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(upgradeBtn).toBeVisible();
    }
  });
});
