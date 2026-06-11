import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders with hero and key sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    // The landing page should have key sections visible
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
  });

  test('navigation links are present', async ({ page }) => {
    await page.goto('/');
    // Should have sign in or get started links
    const authLink = page.locator('a:has-text("Sign"), a:has-text("Get Started"), a:has-text("Login"), button:has-text("Sign")');
    await expect(authLink.first()).toBeVisible({ timeout: 10_000 });
  });

  test('static pages load without errors', async ({ page }) => {
    const staticPages = ['/about', '/changelog', '/support', '/privacy', '/terms'];
    for (const path of staticPages) {
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      // Verify no error state (404 page or error boundary)
      const errorHeading = page.locator('text=404, text=Not Found, text=Something went wrong');
      const hasError = await errorHeading.isVisible({ timeout: 1000 }).catch(() => false);
      expect(hasError).toBe(false);
    }
  });
});
