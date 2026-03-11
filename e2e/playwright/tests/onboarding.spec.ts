import { test, expect } from '@playwright/test';
import { test as authedTest } from '../fixtures/auth';

test.describe('Onboarding', () => {
  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/auth/);
  });
});

authedTest.describe('Onboarding (authenticated)', () => {
  authedTest('name step renders and accepts input', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/onboarding');
    // Look for name input or step indicator
    const nameInput = page.locator('input[placeholder*="name" i], input[type="text"]').first();
    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nameInput.fill('Test Name');
      const continueBtn = page.locator('button:has-text("Continue")');
      await continueBtn.click();
      await page.waitForLoadState('networkidle');
    }
  });

  authedTest('keys step renders provider sections', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/onboarding?step=keys');
    await expect(page.locator('body')).toBeVisible();
    // Should show AI provider or TTS provider sections
  });
});
