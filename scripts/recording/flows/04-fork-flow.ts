import type { Page } from 'playwright';
import { humanType, waitAndSettle, humanClick } from '../lib/actions';
import { interceptFork } from '../lib/interceptors';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  const cryptoPodcast = ctx.demoPodcasts['cryptography'];
  if (!cryptoPodcast) throw new Error('Cryptography podcast not found in context');

  // Set up fork intercept
  await interceptFork(page, cryptoPodcast.id, 'mock-fork-1');

  // Also intercept the redirect that happens after forking
  await page.route(`**/podcast/mock-fork-1`, async (route) => {
    // Prevent the redirect from actually loading — stop recording before then
    await route.abort();
  });

  // Navigate to podcast player
  await page.goto(`${ctx.appUrl}/podcast/${cryptoPodcast.id}`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(1000);

  // Click the Fork button
  await humanClick(page, 'button[aria-label="Fork & remix this podcast"]');

  // Wait for ForkRemixModal to open (step 1)
  await waitAndSettle(page, '[class*="modal"], [role="dialog"]');

  // Type a remix note into the topic/remix field
  const remixInput = page.locator('textarea, input[type="text"]').last();
  await remixInput.click();
  await page.waitForTimeout(200);

  await humanType(
    page,
    'textarea:last-of-type, [class*="modal"] textarea',
    'Exploring the same topic from a behavioral economics angle'
  );
  await page.waitForTimeout(500);

  // Click "Next" to go to step 2
  await humanClick(page, 'button:has-text("Next")');
  await page.waitForTimeout(800);

  // Click "Fork Podcast" button
  await humanClick(page, 'button:has-text("Fork Podcast")');
  await page.waitForTimeout(1500);
}

const forkFlow: FlowScenario = {
  name: '04-fork-flow',
  description: 'Fork/remix a podcast — open modal, fill remix note, confirm',
  viewport: { width: 1440, height: 900 },
  auth: 'demo',
  run,
};

export default forkFlow;
