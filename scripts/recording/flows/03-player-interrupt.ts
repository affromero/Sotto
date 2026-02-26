import type { Page } from 'playwright';
import { humanType, waitAndSettle, humanClick } from '../lib/actions';
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
    answerDelay: 2000,
  });

  // Navigate to podcast player
  await page.goto(`${ctx.appUrl}/podcast/${cryptoPodcast.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for the player to mount
  await waitAndSettle(page, 'button[aria-label="Play"]', 1000);

  // Click play
  await humanClick(page, 'button[aria-label="Play"]');
  await page.waitForTimeout(3000);

  // Click "Ask a Question" button
  await humanClick(page, 'button[aria-label="Ask a question"]');
  await waitAndSettle(page, 'section[aria-label="Ask a question about this podcast"]');

  // Type the question
  const textareaSelector = 'section[aria-label="Ask a question about this podcast"] textarea';
  await humanType(
    page,
    textareaSelector,
    'Could quantum computers break Bitcoin\'s encryption too?'
  );
  await page.waitForTimeout(500);

  // Click submit (the "Ask" button — not type="submit", just a styled button)
  const submitBtn = page.locator('section[aria-label="Ask a question about this podcast"] button:has-text("Ask")');
  await submitBtn.click();

  // Wait for the answer to appear (polling mock returns ANSWERED after ~2s)
  await page.locator('[class*="answerText"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);
}

const playerInterrupt: FlowScenario = {
  name: '03-player-interrupt',
  description: 'Play podcast, interrupt with a question, get AI answer',
  viewport: { width: 1440, height: 900 },
  auth: 'demo',
  run,
};

export default playerInterrupt;
