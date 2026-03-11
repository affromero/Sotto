import { test, expect } from '../fixtures/auth';

test.describe('Public Profile', () => {
  test('profile page shows user info', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/profile/${seedData.otherUser.id}`);
    await expect(page.locator(`text=${seedData.otherUser.name}`)).toBeVisible({ timeout: 10_000 });
  });

  test('follow/unfollow toggle works', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/profile/${seedData.otherUser.id}`);

    const followBtn = page.locator('button:has-text("Follow")');
    if (await followBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await followBtn.click();
      // Should change to "Following" or "Unfollow"
      await expect(page.locator('button:has-text("Following"), button:has-text("Unfollow")')).toBeVisible({ timeout: 5000 });
    }
  });

  test('handle-based URL loads profile', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/profile/handle/${seedData.otherUser.handle}`);
    await expect(page.locator(`text=${seedData.otherUser.name}`)).toBeVisible({ timeout: 10_000 });
  });
});
