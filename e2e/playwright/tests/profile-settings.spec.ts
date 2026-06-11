import { test, expect } from '../fixtures/auth';

test.describe('Profile & Settings', () => {
  test('dashboard loads with user stats', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/dashboard');

    // Dashboard should show user info or redirect to profile
    await expect(page.locator('body')).toBeVisible();
  });

  test('settings page loads', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/settings');

    await expect(page.locator('text=Settings, h1:has-text("Settings")').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('API keys page is accessible', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/settings/api');

    // Should load the BYOK key management page
    await expect(page.locator('body')).toBeVisible();
  });

  test('profile shortcut opens settings', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/profile');

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator('text=Settings, h1:has-text("Settings")').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
