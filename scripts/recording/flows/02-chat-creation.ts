import type { Page } from 'playwright';
import { humanType, waitAndSettle, humanClick } from '../lib/actions';
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

  // Navigate to create page
  await page.goto(`${ctx.appUrl}/create`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitAndSettle(page, 'input[aria-label="Chat message input"]');

  // Type the topic
  await humanType(
    page,
    'input[aria-label="Chat message input"]',
    'The psychology of decision making — why we make irrational choices'
  );
  await page.waitForTimeout(300);

  // Submit by pressing Enter
  await page.keyboard.press('Enter');

  // Wait for AI response to appear + chips
  await page.waitForTimeout(2000);

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

  // Click "Cognitive Biases" chip
  await humanClick(page, 'button:has-text("Cognitive Biases")');
  await page.waitForTimeout(2500);

  // The "Generate Podcast" button should now appear (metadata.ready === true)
  await humanClick(page, 'button[aria-label="Generate your podcast"]');
  await page.waitForTimeout(2000);
}

const chatCreation: FlowScenario = {
  name: '02-chat-creation',
  description: 'Chat with AI to create a podcast — type topic, get suggestions, generate',
  viewport: { width: 1440, height: 900 },
  auth: 'demo',
  run,
};

export default chatCreation;
