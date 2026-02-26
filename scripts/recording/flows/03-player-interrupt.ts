import type { Page } from 'playwright';
import { humanType, waitAndSettle, humanClick, injectCursor, zoomToElement, zoomReset } from '../lib/actions';
import { interceptInteract } from '../lib/interceptors';
import type { FlowScenario, FlowContext } from '../lib/types';

async function run(page: Page, ctx: FlowContext): Promise<void> {
  const cryptoPodcast = ctx.demoPodcasts['cryptography'];
  if (!cryptoPodcast) throw new Error('Cryptography podcast not found in context');

  // Set up interaction intercepts before navigating
  await interceptInteract(page, cryptoPodcast.id, {
    interactionId: 'mock-interaction-1',
    answer:
      "Great question! Bitcoin uses elliptic curve cryptography (specifically secp256k1), not RSA. " +
      "A sufficiently powerful quantum computer running Shor's algorithm could theoretically break " +
      "this encryption. However, we're still decades away from quantum computers powerful enough " +
      "to pose a real threat. The Bitcoin community is already researching quantum-resistant " +
      "signature schemes as a precaution.",
    answerDelay: 1500,
  });

  await page.goto(`${ctx.appUrl}/podcast/${cryptoPodcast.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await waitAndSettle(page, 'button[aria-label="Play"]', 500);
  await injectCursor(page);

  // Zoom into the play button, click it
  await zoomToElement(page, 'button[aria-label="Play"]', 1.6);
  await humanClick(page, 'button[aria-label="Play"]');
  await page.waitForTimeout(800);
  await zoomReset(page);

  // Wait and verify player is in playing state (pause button visible = playing)
  await page.locator('button[aria-label="Pause"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Zoom to "Ask a Question" button
  await zoomToElement(page, 'button[aria-label="Ask a question"]', 1.5);
  await humanClick(page, 'button[aria-label="Ask a question"]');
  await page.waitForTimeout(400);
  await zoomReset(page);
  await waitAndSettle(page, 'section[aria-label="Ask a question about this podcast"]', 300);

  // Zoom into the question panel, type the question
  await zoomToElement(page, 'section[aria-label="Ask a question about this podcast"]', 1.4);
  const textareaSelector = 'section[aria-label="Ask a question about this podcast"] textarea';
  await humanType(
    page,
    textareaSelector,
    'Could quantum computers break Bitcoin\'s encryption too?'
  );
  await page.waitForTimeout(300);

  const submitBtn = page.locator('section[aria-label="Ask a question about this podcast"] button:has-text("Ask")');
  await submitBtn.click();

  // Wait for the answer, stay zoomed so it's readable
  await page.locator('[class*="answerText"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  await zoomReset(page);
  await page.waitForTimeout(500);
}

const playerInterrupt: FlowScenario = {
  name: '03-player-interrupt',
  description: 'Play podcast, interrupt with a question, get AI answer',
  viewport: { width: 1920, height: 1080 },
  auth: 'demo',
  run,
};

export default playerInterrupt;
