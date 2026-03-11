import { test, expect } from '../fixtures/auth';

test.describe('Collections', () => {
  test('collection detail page loads with seeded collection', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/collections/${seedData.collection.id}`);
    await expect(page.locator('text=E2E Test Collection')).toBeVisible({ timeout: 10_000 });
  });

  test('collection shows podcast items', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/collections/${seedData.collection.id}`);
    // Should show the seeded podcast card
    const podcastCard = page.locator('[data-testid="podcast-card"], text=E2E Test Podcast');
    await expect(podcastCard.first()).toBeVisible({ timeout: 10_000 });
  });
});
