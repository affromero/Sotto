/**
 * Browser automation action executor.
 * Adapted from scripts/recording/lib/actions.ts for use in the Remotion sidecar.
 */
import type { Page } from 'playwright';
import { setupInterceptor, clearInterceptor } from './interceptors';

interface DemoAction {
  type: string;
  [key: string]: unknown;
}

/** Inject a visible cursor dot that tracks mouse movement. */
async function injectCursor(page: Page): Promise<void> {
  await page.evaluate(`
    (function() {
      if (document.getElementById('pw-cursor')) return;
      var cursor = document.createElement('div');
      cursor.id = 'pw-cursor';
      cursor.style.cssText = 'position:fixed;z-index:999999;width:24px;height:24px;border-radius:50%;' +
        'background:rgba(217,119,6,0.5);border:2px solid rgba(217,119,6,0.9);' +
        'pointer-events:none;transform:translate(-50%,-50%);transition:transform 0.08s,opacity 0.15s;' +
        'left:-50px;top:-50px;opacity:0;';
      document.body.appendChild(cursor);
      var ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;z-index:999998;width:40px;height:40px;border-radius:50%;' +
        'border:1.5px solid rgba(217,119,6,0.3);pointer-events:none;transform:translate(-50%,-50%);' +
        'transition:transform 0.12s,opacity 0.2s;left:-50px;top:-50px;opacity:0;';
      ring.id = 'pw-cursor-ring';
      document.body.appendChild(ring);
      document.addEventListener('mousemove', function(e) {
        cursor.style.left = e.clientX + 'px';
        cursor.style.top = e.clientY + 'px';
        cursor.style.opacity = '1';
        ring.style.left = e.clientX + 'px';
        ring.style.top = e.clientY + 'px';
        ring.style.opacity = '1';
      });
      document.addEventListener('mousedown', function() {
        cursor.style.transform = 'translate(-50%,-50%) scale(0.7)';
        ring.style.transform = 'translate(-50%,-50%) scale(0.8)';
      });
      document.addEventListener('mouseup', function() {
        cursor.style.transform = 'translate(-50%,-50%) scale(1)';
        ring.style.transform = 'translate(-50%,-50%) scale(1)';
      });
    })()
  `);
}

/** Smoothly zoom into a specific element. */
async function zoomToElement(
  page: Page,
  selector: string,
  scale: number = 1.5,
  duration: number = 500,
): Promise<void> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox().catch(() => null);
  if (!box) return;

  const vw = await page.evaluate('window.innerWidth');
  const vh = await page.evaluate('window.innerHeight');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const originX = ((cx / vw) * 100).toFixed(1);
  const originY = ((cy / vh) * 100).toFixed(1);

  await page.evaluate(`
    (function() {
      document.documentElement.style.transition = 'transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)';
      document.documentElement.style.transformOrigin = '${originX}% ${originY}%';
      document.documentElement.style.transform = 'scale(${scale})';
    })()
  `);
  await page.waitForTimeout(duration + 100);
}

/** Reset zoom back to normal. */
async function zoomReset(page: Page, duration: number = 400): Promise<void> {
  await page.evaluate(`
    (function() {
      document.documentElement.style.transition = 'transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)';
      document.documentElement.style.transform = 'scale(1)';
    })()
  `);
  await page.waitForTimeout(duration + 100);
}

/** Type text keystroke-by-keystroke with variable delays. */
async function humanType(
  page: Page,
  selector: string,
  text: string,
  speed: { min: number; max: number } = { min: 30, max: 60 },
): Promise<void> {
  const el = page.locator(selector);
  await el.click();
  for (const char of text) {
    await el.pressSequentially(char, { delay: 0 });
    const delay = speed.min + Math.random() * (speed.max - speed.min);
    await page.waitForTimeout(delay);
  }
}

/** Smooth scroll with easing via requestAnimationFrame. */
async function smoothScroll(page: Page, distance: number, duration: number = 800): Promise<void> {
  await page.evaluate(`
    new Promise((resolve) => {
      var dist = ${distance};
      var dur = ${duration};
      var start = performance.now();
      var startY = window.scrollY;
      function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }
      function step(now) {
        var elapsed = now - start;
        var progress = Math.min(elapsed / dur, 1);
        var eased = easeInOutCubic(progress);
        window.scrollTo(0, startY + dist * eased);
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(step);
    })
  `);
}

/** Hover briefly then click. */
async function humanClick(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector);
  await el.hover();
  await page.waitForTimeout(150);
  await el.click();
}

/**
 * Execute a sequence of DemoAction steps on a Playwright page.
 * Injects a visible cursor on the first navigate action.
 */
export async function executeActions(page: Page, actions: DemoAction[]): Promise<void> {
  let cursorInjected = false;

  for (const action of actions) {
    switch (action.type) {
      case 'navigate': {
        await page.goto(action.url as string, { waitUntil: 'networkidle' });
        if (!cursorInjected) {
          await injectCursor(page);
          cursorInjected = true;
        }
        break;
      }
      case 'click':
        await humanClick(page, action.selector as string);
        break;
      case 'type': {
        const speed = action.speed as { min: number; max: number } | undefined;
        await humanType(page, action.selector as string, action.text as string, speed);
        break;
      }
      case 'wait':
        await page.waitForTimeout(action.ms as number);
        break;
      case 'scroll':
        await smoothScroll(page, action.distance as number, action.duration as number | undefined);
        break;
      case 'zoom':
        await zoomToElement(
          page,
          action.selector as string,
          action.scale as number | undefined,
          action.duration as number | undefined,
        );
        break;
      case 'zoomReset':
        await zoomReset(page, action.duration as number | undefined);
        break;
      case 'hover':
        await page.locator(action.selector as string).hover();
        break;
      case 'waitForSelector':
        await page.locator(action.selector as string).waitFor({
          state: 'visible',
          timeout: (action.timeout as number) ?? 10000,
        });
        break;
      case 'intercept':
        await setupInterceptor(
          page,
          action.name as string,
          action.options as Record<string, unknown>,
        );
        break;
      case 'clearIntercept':
        await clearInterceptor(page, action.name as string);
        break;
      case 'keypress':
        await page.keyboard.press(action.key as string);
        break;
      case 'screenshot':
        // Screenshots are captured automatically by recordVideo
        await page.waitForTimeout(500);
        break;
      default:
        console.warn(`Unknown action type: ${action.type}`);
    }
  }
}
