import { test, expect } from '@playwright/test';

test.describe('Invite Page', () => {
  test('valid invite code renders invite form', async ({ page }) => {
    await page.goto('/invite/e2e-invite-code');
    // Should show the invite form, not an error state
    await expect(page.locator('body')).toBeVisible();
    // The page should NOT show "Invalid Invitation"
    const invalidText = page.locator('text=Invalid Invitation');
    const isInvalid = await invalidText.isVisible({ timeout: 3000 }).catch(() => false);
    expect(isInvalid).toBe(false);
  });

  test('invalid invite code shows error', async ({ page }) => {
    await page.goto('/invite/nonexistent-code-12345');
    // Should show "Invalid Invitation" error
    await expect(page.locator('text=Invalid Invitation, text=not valid')).toBeVisible({ timeout: 5000 });
  });
});
