import type { Page } from 'playwright';
import { humanClick, injectCursor, zoomToElement, zoomReset } from '../lib/actions';
import { interceptFork } from '../lib/interceptors';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  const cryptoPodcast = ctx.demoPodcasts['cryptography'];
  if (!cryptoPodcast) throw new Error('Cryptography podcast not found in context');

  // Set up fork intercept — return the same podcast ID so redirect loads a real page
  await interceptFork(page, cryptoPodcast.id, cryptoPodcast.id);

  // Navigate to podcast player
  await page.goto(`${ctx.appUrl}/podcast/${cryptoPodcast.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(500);
  await injectCursor(page);

  // Zoom into the fork button
  await zoomToElement(page, 'button[aria-label="Fork & remix this podcast"]', 1.6);
  await humanClick(page, 'button[aria-label="Fork & remix this podcast"]');
  await page.waitForTimeout(400);
  await zoomReset(page);

  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 });

  // Zoom into the modal
  await zoomToElement(page, '[role="dialog"]', 1.3);
  const modal = page.getByRole('dialog');
  const textarea = modal.locator('textarea').first();
  await textarea.click();
  await page.waitForTimeout(100);
  await textarea.pressSequentially('Exploring the same topic from a behavioral economics angle', { delay: 40 });
  await page.waitForTimeout(300);

  await humanClick(page, 'button:has-text("Next")');
  await page.waitForTimeout(600);

  await humanClick(page, 'button:has-text("Fork Podcast")');

  // Wait for redirect to load the forked podcast page
  await page.waitForTimeout(500);
  await zoomReset(page);
  await page.waitForTimeout(1500);
}

const forkFlow: FlowScenario = {
  name: '04-fork-flow',
  description: 'Fork/remix a podcast — open modal, fill remix note, confirm',
  viewport: { width: 1920, height: 1080 },
  auth: 'viewer',
  run,
};

export default forkFlow;
