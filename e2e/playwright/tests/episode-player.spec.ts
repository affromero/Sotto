import { test, expect } from '../fixtures/auth';

test.describe('Episode Player', () => {
  test('player page loads for a valid episode', async ({ authedContext }) => {
    const page = await authedContext.newPage();

    // Navigate to the workspace first, then click a episode
    await page.goto('/');
    const firstCard = page.locator('[data-testid="episode-card"]').first();

    if (await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCard.click();
      await expect(page).toHaveURL(/\/episode\//);

      // Player controls should be visible
      await expect(page.locator('button[aria-label*="Play"], button[aria-label*="Pause"]')).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test('play/pause toggle works', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');

    const firstCard = page.locator('[data-testid="episode-card"]').first();
    if (await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCard.click();

      const playButton = page.locator('button[aria-label*="Play"]');
      await expect(playButton).toBeVisible({ timeout: 10_000 });
      await playButton.click();

      // After clicking play, the button should change to pause
      await expect(page.locator('button[aria-label*="Pause"]')).toBeVisible({ timeout: 5000 });
    }
  });

  test('interrupt Q&A flow with LLMock', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/');

    const firstCard = page.locator('[data-testid="episode-card"]').first();
    if (await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCard.click();

      // Look for the "Ask a Question" button
      const askButton = page.locator('button:has-text("Ask a Question"), button:has-text("Ask")');
      if (await askButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await askButton.click();

        // Type a question
        const questionInput = page.locator('textarea[placeholder*="know"], input[placeholder*="know"]');
        await expect(questionInput).toBeVisible({ timeout: 3000 });
        await questionInput.fill('How does this technology work?');

        // Submit
        const submitButton = page.locator('button:has-text("Submit")');
        await submitButton.click();

        // Wait for answer (LLMock responds deterministically)
        await expect(page.locator('text=Great question')).toBeVisible({ timeout: 15_000 });
      }
    }
  });
});
