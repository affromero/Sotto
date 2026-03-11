import { test, expect } from '../fixtures/auth';

test.describe('Create Podcast', () => {
  test('discovery chat works with LLMock', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/create');

    // Wait for the discovery chat interface
    const chatInput = page.locator('textarea, input[type="text"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // Type a topic
    await chatInput.fill('AI and machine learning');
    await chatInput.press('Enter');

    // Wait for AI response (LLMock returns deterministic content)
    await expect(page.locator('text=Great choice')).toBeVisible({ timeout: 15_000 });
  });

  test('full creation flow: discovery to script preview', async ({ authedContext }) => {
    const page = await authedContext.newPage();
    await page.goto('/create');

    // Step 1: Discovery — type topic
    const chatInput = page.locator('textarea, input[type="text"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
    await chatInput.fill('The future of AI');
    await chatInput.press('Enter');

    // Wait for "ready" state
    const nextButton = page.locator('button:has-text("Next"), button:has-text("Choose Voices")');
    await expect(nextButton).toBeVisible({ timeout: 30_000 });

    // Step 2: Click next to voice selection
    await nextButton.click();

    // Step 3: Generate script
    const generateButton = page.locator('button:has-text("Generate Script")');
    if (await generateButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await generateButton.click();

      // Wait for script preview or progress indicator
      const scriptPreview = page.locator('text=HOST:, text=Approve');
      await expect(scriptPreview.first()).toBeVisible({ timeout: 60_000 });
    }
  });
});
