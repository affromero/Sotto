import type { Page } from 'playwright';
import { smoothScroll, humanClick, injectCursor, zoomToElement, zoomReset } from '../lib/actions';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  await page.goto(`${ctx.appUrl}/feed`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 15000 });
  await injectCursor(page);
  await page.waitForTimeout(1200);

  // Scroll down to reveal more cards
  await smoothScroll(page, 400, 600);
  await page.waitForTimeout(500);

  // Zoom into tag filter area, click "Technology"
  const techTag = page.locator('button:has-text("Technology")').first();
  if (await techTag.isVisible({ timeout: 2000 }).catch(() => false)) {
    await zoomToElement(page, 'button:has-text("Technology")', 1.8);
    await humanClick(page, 'button:has-text("Technology")');
    await page.waitForTimeout(600);
    await zoomReset(page);
    await page.waitForTimeout(400);
  }

  // Zoom into sort pills, click "Popular"
  const popularPill = page.locator('button:has-text("Popular")').first();
  if (await popularPill.isVisible({ timeout: 2000 }).catch(() => false)) {
    await zoomToElement(page, 'button:has-text("Popular")', 1.8);
    await humanClick(page, 'button:has-text("Popular")');
    await page.waitForTimeout(500);
    await zoomReset(page);
    await page.waitForTimeout(400);
  }

  // Hover over first card — zoom in to show detail
  const firstCard = page.locator('article').first();
  if (await firstCard.isVisible({ timeout: 2000 }).catch(() => false)) {
    await zoomToElement(page, 'article', 1.4);
    await firstCard.hover();
    await page.waitForTimeout(1000);
    await zoomReset(page);
  }

  await smoothScroll(page, -400, 500);
  await page.waitForTimeout(300);
}

const feedBrowsing: FlowScenario = {
  name: '01-feed-browsing',
  description: 'Feed/discovery browsing — scroll, filter by tag, sort by popular',
  viewport: { width: 1920, height: 1080 },
  auth: 'none',
  run,
};

export default feedBrowsing;
