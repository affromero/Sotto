import type { Page } from 'playwright';
import { smoothScroll, injectCursor, zoomToElement, zoomReset } from '../lib/actions';
import { interceptScriptApprove } from '../lib/interceptors';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  const scriptReadyPodcast = ctx.demoPodcasts['scriptReady'];
  if (!scriptReadyPodcast) throw new Error('SCRIPT_READY podcast not found in context');

  // Set up script approve intercept
  await interceptScriptApprove(page, scriptReadyPodcast.id);

  // Navigate to the SCRIPT_READY podcast page (as owner)
  await page.goto(`${ctx.appUrl}/podcast/${scriptReadyPodcast.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for the approve button to render (confirms SCRIPT_READY state loaded)
  // Two matching buttons exist (mobile + desktop), so use .first()
  const approveBtn = page.getByRole('button', { name: 'Approve & Generate Audio' }).first();
  await approveBtn.waitFor({ state: 'visible', timeout: 15000 });
  await injectCursor(page);
  await page.waitForTimeout(1000);

  // Scroll through the script — zoom in to show turn detail
  await smoothScroll(page, 300, 600);
  await page.waitForTimeout(300);
  await zoomToElement(page, '[class*="turn"], [class*="Turn"], main', 1.4);
  await page.waitForTimeout(1000);
  await zoomReset(page);

  await smoothScroll(page, 300, 600);
  await page.waitForTimeout(800);

  // Scroll back up to approve button
  await smoothScroll(page, -200, 400);
  await page.waitForTimeout(300);

  // Zoom into approve button
  await zoomToElement(page, 'button:has-text("Approve & Generate Audio")', 1.5);
  await approveBtn.hover();
  await page.waitForTimeout(150);
  await approveBtn.click();
  await page.waitForTimeout(1200);
  await zoomReset(page);
  await page.waitForTimeout(500);
}

const scriptReview: FlowScenario = {
  name: '05-script-review',
  description: 'Review SCRIPT_READY podcast — scroll turns, approve to generate audio',
  viewport: { width: 1920, height: 1080 },
  auth: 'demo',
  run,
};

export default scriptReview;
