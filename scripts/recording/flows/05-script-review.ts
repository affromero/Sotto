import type { Page } from 'playwright';
import { smoothScroll } from '../lib/actions';
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
  await page.waitForTimeout(2000);

  // Scroll through the script turns
  await smoothScroll(page, 300, 1000);
  await page.waitForTimeout(1000);

  await smoothScroll(page, 300, 1000);
  await page.waitForTimeout(1500);

  // Scroll back up to the approve button
  await smoothScroll(page, -200, 600);
  await page.waitForTimeout(500);

  // Click "Approve & Generate Audio"
  await approveBtn.hover();
  await page.waitForTimeout(200);
  await approveBtn.click();
  await page.waitForTimeout(2000);
}

const scriptReview: FlowScenario = {
  name: '05-script-review',
  description: 'Review SCRIPT_READY podcast — scroll turns, approve to generate audio',
  viewport: { width: 1440, height: 900 },
  auth: 'demo',
  run,
};

export default scriptReview;
