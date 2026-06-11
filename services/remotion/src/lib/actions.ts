/**
 * Browser automation action executor.
 * Used by the Remotion sidecar for browser-driven render actions.
 */
import type { Page } from 'playwright';
import { setupInterceptor, clearInterceptor } from './interceptors';

interface BrowserAction {
  type: string;
  [key: string]: unknown;
}

export interface ActionTimingEntry {
  type: string;
  timestampMs: number;
  meta?: Record<string, unknown>;
}

interface CursorPos {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Bezier mouse movement — natural arced paths with overshoot
// ---------------------------------------------------------------------------

/** Compute a point on a cubic bezier curve at parameter t (0-1). */
function cubicBezierPoint(
  p0: CursorPos,
  p1: CursorPos,
  p2: CursorPos,
  p3: CursorPos,
  t: number,
): CursorPos {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/** Ease-out cubic — fast start, gentle deceleration. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Move the mouse along a cubic bezier arc from `from` to `to`.
 * The control points create a natural curved path with slight randomness.
 * Includes a small overshoot past the target, then eases back.
 */
async function bezierMoveTo(
  page: Page,
  from: CursorPos,
  to: CursorPos,
  options: { steps?: number; durationMs?: number; overshoot?: number } = {},
): Promise<void> {
  const { steps = 25, durationMs = 400, overshoot = 8 } = options;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Skip bezier for very short moves
  if (dist < 5) {
    await page.mouse.move(to.x, to.y);
    return;
  }

  // Perpendicular offset for the arc — scales with distance, capped at 120px
  const perpMagnitude = Math.min(dist * 0.3, 120);
  // Random direction: curve left or right
  const perpSign = Math.random() > 0.5 ? 1 : -1;
  // Normalized perpendicular vector
  const perpX = (-dy / dist) * perpMagnitude * perpSign;
  const perpY = (dx / dist) * perpMagnitude * perpSign;

  // Control points: offset from the straight line at 1/3 and 2/3 marks
  const cp1: CursorPos = {
    x: from.x + dx * 0.33 + perpX * 0.8,
    y: from.y + dy * 0.33 + perpY * 0.8,
  };
  const cp2: CursorPos = {
    x: from.x + dx * 0.67 + perpX * 0.4,
    y: from.y + dy * 0.67 + perpY * 0.4,
  };

  // Overshoot target — extend slightly past the destination
  const overshootTarget: CursorPos = {
    x: to.x + (dx / dist) * overshoot,
    y: to.y + (dy / dist) * overshoot,
  };

  // Phase 1: bezier arc to overshoot point
  const mainSteps = Math.max(Math.round(steps * 0.85), 10);
  const stepDelay = durationMs / steps;

  for (let i = 1; i <= mainSteps; i++) {
    const t = easeOutCubic(i / mainSteps);
    // Blend bezier curve toward overshoot target at the end
    const bezierT = Math.min(t * 1.05, 1);
    const bp = cubicBezierPoint(from, cp1, cp2, overshootTarget, bezierT);
    await page.mouse.move(Math.round(bp.x), Math.round(bp.y));
    await page.waitForTimeout(stepDelay);
  }

  // Phase 2: ease back from overshoot to actual target
  const settleSteps = steps - mainSteps;
  for (let i = 1; i <= settleSteps; i++) {
    const t = i / settleSteps;
    const x = overshootTarget.x + (to.x - overshootTarget.x) * easeOutCubic(t);
    const y = overshootTarget.y + (to.y - overshootTarget.y) * easeOutCubic(t);
    await page.mouse.move(Math.round(x), Math.round(y));
    await page.waitForTimeout(stepDelay * 0.6);
  }
}

/** Get the center coordinates of an element. */
async function getElementCenter(page: Page, selector: string): Promise<CursorPos | null> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox().catch(() => null);
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ---------------------------------------------------------------------------
// Hover highlight — golden-amber glow before clicking
// ---------------------------------------------------------------------------

/** Inject a transient highlight glow on a target element. */
async function injectHighlight(page: Page, selector: string): Promise<void> {
  await page.evaluate(`
    (function() {
      var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
      if (!el) return;
      el.dataset.prevBoxShadow = el.style.boxShadow || '';
      el.dataset.prevTransition = el.style.transition || '';
      el.style.transition = 'box-shadow 0.2s ease-out';
      el.style.boxShadow = '0 0 0 3px rgba(217,119,6,0.3), 0 0 16px rgba(217,119,6,0.15)';
    })()
  `);
}

/** Remove the highlight glow from a target element. */
async function removeHighlight(page: Page, selector: string): Promise<void> {
  await page.evaluate(`
    (function() {
      var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
      if (!el) return;
      el.style.boxShadow = el.dataset.prevBoxShadow || '';
      setTimeout(function() {
        el.style.transition = el.dataset.prevTransition || '';
        delete el.dataset.prevBoxShadow;
        delete el.dataset.prevTransition;
      }, 200);
    })()
  `);
}

// ---------------------------------------------------------------------------
// Cursor injection — golden-amber dot + ring
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Zoom — smooth CSS transform
// ---------------------------------------------------------------------------

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

  const vw = await page.evaluate('window.innerWidth') as number;
  const vh = await page.evaluate('window.innerHeight') as number;
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

// ---------------------------------------------------------------------------
// Typing — keystroke-by-keystroke with accurate timestamp recording
// ---------------------------------------------------------------------------

/**
 * Type text keystroke-by-keystroke with variable delays.
 * Records actual per-character offset timestamps for accurate SFX placement.
 */
async function humanType(
  page: Page,
  selector: string,
  text: string,
  speed: { min: number; max: number } = { min: 30, max: 60 },
): Promise<number[]> {
  const el = page.locator(selector);
  await el.click();
  const actionStart = Date.now();
  const keystrokeOffsets: number[] = [];

  for (const char of text) {
    keystrokeOffsets.push(Date.now() - actionStart);
    await el.pressSequentially(char, { delay: 0 });
    const delay = speed.min + Math.random() * (speed.max - speed.min);
    await page.waitForTimeout(delay);
  }

  return keystrokeOffsets;
}

// ---------------------------------------------------------------------------
// Scroll — smooth easeInOutCubic
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Click — bezier path + hover highlight + click
// ---------------------------------------------------------------------------

/** Move to element via bezier arc, highlight, then click. */
async function humanClick(
  page: Page,
  selector: string,
  cursorPos: CursorPos,
): Promise<void> {
  const target = await getElementCenter(page, selector);
  if (!target) {
    // Fallback: simple click without bezier
    const el = page.locator(selector);
    await el.hover();
    await page.waitForTimeout(150);
    await el.click();
    return;
  }

  // Bezier arc to target
  await bezierMoveTo(page, cursorPos, target);

  // Highlight glow
  await injectHighlight(page, selector);
  await page.waitForTimeout(200);

  // Click
  await page.mouse.click(target.x, target.y);

  // Remove highlight after click
  await page.waitForTimeout(100);
  await removeHighlight(page, selector);

  // Update cursor position
  cursorPos.x = target.x;
  cursorPos.y = target.y;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

/**
 * Execute a sequence of browser action steps on a Playwright page.
 * Injects a visible cursor on the first navigate action.
 * Returns an action timing log for SFX placement.
 */
export async function executeActions(page: Page, actions: BrowserAction[]): Promise<ActionTimingEntry[]> {
  let cursorInjected = false;
  const startTime = Date.now();
  const timingLog: ActionTimingEntry[] = [];
  const cursorPos: CursorPos = { x: 640, y: 360 }; // viewport center (1280x720)

  for (const action of actions) {
    const timestampMs = Date.now() - startTime;

    switch (action.type) {
      case 'navigate': {
        timingLog.push({ type: 'navigate', timestampMs });
        await page.goto(action.url as string, { waitUntil: 'networkidle' });
        if (!cursorInjected) {
          await injectCursor(page);
          // Move mouse to initial position so the cursor becomes visible
          await page.mouse.move(cursorPos.x, cursorPos.y);
          cursorInjected = true;
        }
        break;
      }
      case 'click': {
        const clickTarget = await getElementCenter(page, action.selector as string);
        timingLog.push({
          type: 'click',
          timestampMs,
          meta: clickTarget ? { fromX: cursorPos.x, fromY: cursorPos.y, toX: clickTarget.x, toY: clickTarget.y } : undefined,
        });
        await humanClick(page, action.selector as string, cursorPos);
        if (clickTarget) {
          cursorPos.x = clickTarget.x;
          cursorPos.y = clickTarget.y;
        }
        break;
      }
      case 'type': {
        const text = action.text as string;
        const speed = action.speed as { min: number; max: number } | undefined;
        const keystrokeOffsets = await humanType(page, action.selector as string, text, speed);
        timingLog.push({
          type: 'type',
          timestampMs,
          meta: { charCount: text.length, keystrokeOffsets },
        });
        break;
      }
      case 'wait':
        timingLog.push({ type: 'wait', timestampMs, meta: { ms: action.ms } });
        await page.waitForTimeout(action.ms as number);
        break;
      case 'scroll':
        timingLog.push({ type: 'scroll', timestampMs, meta: { distance: action.distance, durationMs: action.duration ?? 800 } });
        await smoothScroll(page, action.distance as number, action.duration as number | undefined);
        break;
      case 'zoom':
        timingLog.push({ type: 'zoom', timestampMs, meta: { selector: action.selector, scale: action.scale } });
        await zoomToElement(
          page,
          action.selector as string,
          action.scale as number | undefined,
          action.duration as number | undefined,
        );
        break;
      case 'zoomReset':
        timingLog.push({ type: 'zoomReset', timestampMs });
        await zoomReset(page, action.duration as number | undefined);
        break;
      case 'hover': {
        const hoverTarget = await getElementCenter(page, action.selector as string);
        timingLog.push({ type: 'hover', timestampMs });
        if (hoverTarget) {
          await bezierMoveTo(page, cursorPos, hoverTarget);
          cursorPos.x = hoverTarget.x;
          cursorPos.y = hoverTarget.y;
        } else {
          // Element not visible — try briefly, skip if absent (avoids 30s timeout crashing the recording)
          try {
            await page.locator(action.selector as string).hover({ timeout: 3000 });
          } catch {
            console.warn(`[hover] selector not found, skipping: ${action.selector as string}`);
          }
        }
        break;
      }
      case 'waitForSelector':
        timingLog.push({ type: 'waitForSelector', timestampMs });
        await page.locator(action.selector as string).waitFor({
          state: 'visible',
          timeout: (action.timeout as number) ?? 10000,
        });
        break;
      case 'intercept':
        timingLog.push({ type: 'intercept', timestampMs, meta: { name: action.name } });
        await setupInterceptor(
          page,
          action.name as string,
          action.options as Record<string, unknown>,
        );
        break;
      case 'clearIntercept':
        timingLog.push({ type: 'clearIntercept', timestampMs, meta: { name: action.name } });
        await clearInterceptor(page, action.name as string);
        break;
      case 'keypress':
        timingLog.push({ type: 'keypress', timestampMs, meta: { key: action.key } });
        await page.keyboard.press(action.key as string);
        break;
      case 'screenshot':
        timingLog.push({ type: 'screenshot', timestampMs });
        // Screenshots are captured automatically by recordVideo
        await page.waitForTimeout(500);
        break;
      default:
        console.warn(`Unknown action type: ${action.type}`);
    }
  }

  return timingLog;
}
