import type { Page } from 'playwright';
import { smoothScroll, humanClick, waitAndSettle } from '../lib/actions';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  // Navigate to feed
  await page.goto(`${ctx.appUrl}/feed`, { waitUntil: 'networkidle', timeout: 30000 });
  await waitAndSettle(page, 'nav[aria-label="Filter by tag"]');

  // Scroll down to reveal more cards
  await smoothScroll(page, 400, 1000);
  await page.waitForTimeout(800);

  // Click "Technology" tag chip
  await humanClick(page, 'nav[aria-label="Filter by tag"] button:has-text("Technology")');
  await page.waitForTimeout(1200);

  // Click "Popular" sort pill
  await humanClick(page, 'div[aria-label="Sort order"] button:has-text("Popular")');
  await page.waitForTimeout(1000);

  // Hover over the first PodcastCard to reveal fork button
  const firstCard = page.locator('[class*="card"]').first();
  await firstCard.hover();
  await page.waitForTimeout(1500);

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
