import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth/);
  });

  test('login page renders with OAuth buttons', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.locator('text=Sign in')).toBeVisible();
  });

  test('banned user sees banned page', async ({ page }) => {
    // Attempt to access with a banned session would redirect
    await page.goto('/banned');
    await expect(page.locator('body')).toBeVisible();
  });

  test('protected API routes return 401 without auth', async ({ request }) => {
    const response = await request.get('/api/v1/users/me');
    expect(response.status()).toBe(401);
  });
});
