import type { Page } from 'playwright';
import { humanType, waitAndSettle, humanClick, injectCursor, zoomToElement, zoomReset } from '../lib/actions';
import { interceptDiscovery, clearDiscoveryIntercept } from '../lib/interceptors';
import type { FlowScenario, FlowContext } from '../lib/types';
import type { DiscoveryMetadata } from '@sotto/shared';

const INITIAL_METADATA: DiscoveryMetadata = {
  topic: 'The Psychology of Decision Making',
  depth: 'standard',
  audienceLevel: 'intermediate',
  audience: 'general',
  focusAreas: [],
  tone: 'casual',
  durationTarget: 10,
  ready: false,
};

const READY_METADATA: DiscoveryMetadata = {
  ...INITIAL_METADATA,
  focusAreas: ['Cognitive Biases', 'Behavioral Economics'],
  ready: true,
};

async function run(page: Page, ctx: FlowContext): Promise<void> {
  // Set up first discovery intercept — initial conversation
  await interceptDiscovery(page, {
    textChunks: [
      'Great topic! Decision making is a fascinating area ',
      'that sits at the intersection of psychology, ',
      'neuroscience, and behavioral economics. ',
      'Let me help you shape this into an engaging podcast.',
    ],
    chips: ['Cognitive Biases', 'Behavioral Economics', 'Nudge Theory'],
    metadata: INITIAL_METADATA,
  });

  await page.goto(`${ctx.appUrl}/create`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitAndSettle(page, 'input[aria-label="Chat message input"]');
  await injectCursor(page);

  // Zoom into the chat input
  await zoomToElement(page, 'input[aria-label="Chat message input"]', 1.5);
  await humanType(
    page,
    'input[aria-label="Chat message input"]',
    'The psychology of decision making — why we make irrational choices'
  );
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await zoomReset(page);

  // Wait for AI response to appear + chips
  await page.waitForTimeout(1500);

  // Clear the first intercept, set up the second with ready: true
  await clearDiscoveryIntercept(page);
  await interceptDiscovery(page, {
    textChunks: [
      'Perfect — focusing on cognitive biases gives us a rich angle. ',
      "I'll cover anchoring, loss aversion, and the paradox of choice. ",
      'This is ready to generate!',
    ],
    chips: ['Anchoring Effect', 'Loss Aversion', 'Paradox of Choice'],
    metadata: READY_METADATA,
  });

  // Zoom into chips area, click "Cognitive Biases"
  await zoomToElement(page, 'button:has-text("Cognitive Biases")', 1.6);
  await humanClick(page, 'button:has-text("Cognitive Biases")');
  await page.waitForTimeout(800);
  await zoomReset(page);
  await page.waitForTimeout(1000);

  // Zoom into generate button
  await zoomToElement(page, 'button[aria-label="Generate your podcast"]', 1.6);
  await humanClick(page, 'button[aria-label="Generate your podcast"]');
  await page.waitForTimeout(1200);
  await zoomReset(page);
}

const chatCreation: FlowScenario = {
  name: '02-chat-creation',
  description: 'Chat with AI to create a podcast — type topic, get suggestions, generate',
  viewport: { width: 1920, height: 1080 },
  auth: 'demo',
  run,
};

export default chatCreation;
