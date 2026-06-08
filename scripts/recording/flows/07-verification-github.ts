import type { Page } from 'playwright';
import { smoothScroll, injectCursor } from '../lib/actions';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, _ctx: FlowContext): Promise<void> {
  const verificationStandardUrl = process.env.NEXT_PUBLIC_VERIFICATION_STANDARD_URL?.trim();
  if (!verificationStandardUrl) {
    throw new Error('NEXT_PUBLIC_VERIFICATION_STANDARD_URL is required for this recording flow');
  }

  await page.goto(verificationStandardUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(1500);
  await injectCursor(page);

  // Scroll through the README
  await smoothScroll(page, 500, 800);
  await page.waitForTimeout(800);

  await smoothScroll(page, 500, 800);
  await page.waitForTimeout(800);

  await smoothScroll(page, 500, 800);
  await page.waitForTimeout(800);

  await smoothScroll(page, 500, 800);
  await page.waitForTimeout(800);

  // Scroll back to top
  await smoothScroll(page, -2000, 1000);
  await page.waitForTimeout(500);
}

const verificationGithub: FlowScenario = {
  name: '07-verification-github',
  description: 'Open-source verification standard — GitHub repo and README',
  viewport: { width: 1920, height: 1080 },
  auth: 'none',
  run,
};

export default verificationGithub;
