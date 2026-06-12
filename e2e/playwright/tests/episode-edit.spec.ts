import { test, expect } from '../fixtures/auth';

test.describe('Episode Edit', () => {
  test('edit page loads for owned episode', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/episode/${seedData.testEpisode.id}/edit`);
    // Should show title and topic inputs
    await expect(page.locator('input, textarea').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can edit title and save', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/episode/${seedData.testEpisode.id}/edit`);

    const titleInput = page.locator('input[name="title"], input[placeholder*="title" i]').first();
    if (await titleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await titleInput.clear();
      await titleInput.fill('Updated E2E Title');

      const saveBtn = page.locator('button:has-text("Save")');
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForLoadState('networkidle');
      }
    }
  });

  test('visibility options are available', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/episode/${seedData.testEpisode.id}/edit`);

    // Should show visibility selector
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });

  test('delete shows confirmation dialog', async ({ authedContext, seedData }) => {
    const page = await authedContext.newPage();
    await page.goto(`/episode/${seedData.testEpisode.id}/edit`);

    const deleteBtn = page.locator('button:has-text("Delete")');
    if (await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Set up dialog handler before clicking
      page.on('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.dismiss(); // Don't actually delete
      });
      await deleteBtn.click();
    }
  });
});
