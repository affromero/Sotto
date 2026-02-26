import type { Page } from 'playwright';
import { smoothScroll, humanClick, waitAndSettle } from '../lib/actions';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  // Navigate to feed (domcontentloaded — feed may poll/stream)
  await page.goto(`${ctx.appUrl}/feed`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for podcast cards to render
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Scroll down to reveal more cards
  await smoothScroll(page, 400, 1000);
  await page.waitForTimeout(800);

  // Click "Technology" tag chip (non-fatal if tags didn't render)
  const techTag = page.locator('button:has-text("Technology")').first();
  if (await techTag.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(page, 'button:has-text("Technology")');
    await page.waitForTimeout(1200);
  }

  // Click "Popular" sort pill (non-fatal)
  const popularPill = page.locator('button:has-text("Popular")').first();
  if (await popularPill.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(page, 'button:has-text("Popular")');
    await page.waitForTimeout(1000);
  }

  // Hover over the first PodcastCard to reveal fork button
  const firstCard = page.locator('[class*="card"]').first();
  if (await firstCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstCard.hover();
    await page.waitForTimeout(1500);
  }

  // Scroll back up
  await smoothScroll(page, -400, 800);
  await page.waitForTimeout(500);
}

const feedBrowsing: FlowScenario = {
  name: '01-feed-browsing',
  description: 'Feed/discovery browsing — scroll, filter by tag, sort by popular',
  viewport: { width: 1440, height: 900 },
  auth: 'none',
  run,
};

export default feedBrowsing;
