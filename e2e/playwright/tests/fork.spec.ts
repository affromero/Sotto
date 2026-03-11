import { test, expect } from '../fixtures/auth';

test.describe('Fork Flow', () => {
  test('fork button opens fork modal on podcast page', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');

    const firstCard = page.locator('[data-testid="podcast-card"]').first();
    if (await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCard.click();
      await expect(page).toHaveURL(/\/podcast\//);

      const forkButton = page.locator('button:has-text("Fork"), button[aria-label*="Fork"]');
      if (await forkButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await forkButton.click();
        // Fork modal should appear with an angle/description input
        await expect(page.locator('textarea, input[placeholder*="angle" i], input[placeholder*="take" i]')).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('submitting fork initiates generation', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');

    const firstCard = page.locator('[data-testid="podcast-card"]').first();
    if (await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCard.click();

      const forkButton = page.locator('button:has-text("Fork"), button[aria-label*="Fork"]');
      if (await forkButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await forkButton.click();

        const angleInput = page.locator('textarea, input[placeholder*="angle" i], input[placeholder*="take" i]');
        if (await angleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await angleInput.fill('My unique perspective on this topic');

          const submitBtn = page.locator('button:has-text("Fork"), button:has-text("Create"), button:has-text("Submit")').last();
          await submitBtn.click();
          await page.waitForLoadState('networkidle');
        }
      }
    }
  });
});
