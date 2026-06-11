import { test, expect } from '@playwright/test';
import { test as authedTest } from '../fixtures/auth';

test.describe('Welcome onboarding', () => {
  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page).toHaveURL(/\/auth/);
  });
});

authedTest.describe('Welcome onboarding (authenticated)', () => {
  authedTest('renders the welcome wizard for a signed-in learner', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/welcome');
    await expect(page.locator('body')).toBeVisible();
    // The wizard's stepper labels its first step "Begin".
    await expect(page.getByText('Begin').first()).toBeVisible({ timeout: 10000 });
  });
});
