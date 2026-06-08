import { test, expect } from '../fixtures/auth';

test.describe('Paid Voice Sharing', () => {
  test('redirects authenticated users to private voice settings by default', async ({
    authedContext,
  }) => {
    const page = await authedContext.newPage();
    await page.goto('/voices');
    await expect(page).toHaveURL(/\/settings\/voices/);
    await expect(page.getByRole('heading', { name: 'Voice Management' })).toBeVisible();
  });
});
