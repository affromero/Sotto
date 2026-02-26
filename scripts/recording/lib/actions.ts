import type { Page, Locator } from 'playwright';

/**
 * Type text keystroke-by-keystroke with variable delays for a human-like feel.
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  speed: { min: number; max: number } = { min: 60, max: 120 }
): Promise<void> {
  const el = page.locator(selector);
  await el.click();
  for (const char of text) {
    await el.pressSequentially(char, { delay: 0 });
    const delay = speed.min + Math.random() * (speed.max - speed.min);
    await page.waitForTimeout(delay);
  }
}

/**
 * Smooth scroll with easing via requestAnimationFrame.
 */
export async function smoothScroll(
  page: Page,
  distance: number,
  duration: number = 800
): Promise<void> {
  await page.evaluate(
    ({ dist, dur }) => {
      return new Promise<void>((resolve) => {
        const start = performance.now();
        const startY = window.scrollY;
        function easeInOutCubic(t: number): number {
          return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }
        function step(now: number) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / dur, 1);
          const eased = easeInOutCubic(progress);
          window.scrollTo(0, startY + dist * eased);
          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        }
        requestAnimationFrame(step);
      });
    },
    { dist: distance, dur: duration }
  );
}

/**
 * Hover briefly then click — mimics human mouse interaction.
 */
export async function humanClick(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector);
  await el.hover();
  await page.waitForTimeout(200);
  await el.click();
}

/**
 * Wait for a selector to appear, then wait extra ms for CSS transitions.
 */
export async function waitAndSettle(
  page: Page,
  selector: string,
  ms: number = 500
): Promise<Locator> {
  const el = page.locator(selector);
  await el.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(ms);
  return el;
}
