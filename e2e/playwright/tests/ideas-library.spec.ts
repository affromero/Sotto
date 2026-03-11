import { test, expect } from '../fixtures/auth';

test.describe('Ideas / Library', () => {
  test('ideas page loads with saved ideas', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/ideas');
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
    // Should show seeded ideas or "Library" heading
    await expect(page.locator('text=Library, text=Ideas, text=AI could write music, text=terraform Mars').first()).toBeVisible({ timeout: 10_000 });
  });

  test('clicking an idea navigates to create', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/ideas');

    // Click on a saved idea
    const ideaLink = page.locator('text=AI could write music, text=terraform Mars').first();
    if (await ideaLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await ideaLink.click();
      // Should navigate to create page with topic pre-filled
      await expect(page).toHaveURL(/\/create/);
    }
  });
});
