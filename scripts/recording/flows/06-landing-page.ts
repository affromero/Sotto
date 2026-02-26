import type { Page } from 'playwright';
import { smoothScroll, injectCursor } from '../lib/actions';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  await page.goto(ctx.appUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await injectCursor(page);

  // Scroll through key sections of the landing page
  await smoothScroll(page, 600, 800);
  await page.waitForTimeout(800);

  await smoothScroll(page, 600, 800);
  await page.waitForTimeout(800);

  await smoothScroll(page, 600, 800);
  await page.waitForTimeout(800);

  await smoothScroll(page, 600, 800);
  await page.waitForTimeout(800);

  await smoothScroll(page, 600, 800);
  await page.waitForTimeout(800);

  // Scroll back to top
  await smoothScroll(page, -3000, 1200);
  await page.waitForTimeout(500);
}

const landingPage: FlowScenario = {
  name: '06-landing-page',
  description: 'Landing page — scroll through hero, features, verification, CTA',
  viewport: { width: 1920, height: 1080 },
  auth: 'none',
  run,
};

export default landingPage;
