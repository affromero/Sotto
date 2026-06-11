import type { Page, Route } from 'playwright';
import type { DiscoveryMetadata } from '@sotto/shared';

// ── SSE Helpers ───────────────────────────────────────────────────

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildSSEBody(chunks: string[], done: {
  chips: string[];
  metadata: DiscoveryMetadata;
}): string {
  let body = '';
  for (const text of chunks) {
    body += sseEvent({ text });
  }
  body += sseEvent({ done: true, chips: done.chips, metadata: done.metadata });
  return body;
}

// ── Discovery (POST /api/v1/discovery) ──────────────────────────────

interface DiscoveryInterceptOptions {
  textChunks: string[];
  chips: string[];
  metadata: DiscoveryMetadata;
}

export async function interceptDiscovery(
  page: Page,
  options: DiscoveryInterceptOptions
): Promise<void> {
  await page.route('**/api/v1/discovery', async (route: Route) => {
    const body = buildSSEBody(options.textChunks, {
      chips: options.chips,
      metadata: options.metadata,
    });

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body,
    });
  });
}

export async function clearDiscoveryIntercept(page: Page): Promise<void> {
  await page.unroute('**/api/v1/discovery');
}

// ── Interact (POST /api/v1/podcasts/*/interact) ─────────────────────

interface InteractInterceptOptions {
  interactionId: string;
  answer: string;
  /** Delay in ms before the polling endpoint returns ANSWERED */
  answerDelay?: number;
}

export async function interceptInteract(
  page: Page,
  podcastId: string,
  options: InteractInterceptOptions
): Promise<void> {
  const postPattern = `**/api/v1/podcasts/${podcastId}/interact`;
  const pollPattern = `**/api/v1/podcasts/${podcastId}/interact/${options.interactionId}`;

  // POST — create interaction
  await page.route(postPattern, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: options.interactionId,
        podcastId,
        question: 'mock question',
        timestamp: 60,
        status: 'PENDING',
        user: { id: 'mock-user', name: 'Alex Rivera', image: null },
      }),
    });
  });

  // GET — poll for answer
  let pollCount = 0;
  const pollsBeforeAnswer = Math.max(1, Math.ceil((options.answerDelay ?? 1500) / 500));

  await page.route(pollPattern, async (route: Route) => {
    pollCount++;
    if (pollCount >= pollsBeforeAnswer) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: options.interactionId,
          question: 'mock question',
          timestamp: 60,
          status: 'ANSWERED',
          answer: options.answer,
          helpful: null,
          segmentOrder: null,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: options.interactionId,
          question: 'mock question',
          timestamp: 60,
          status: 'PENDING',
          answer: null,
          helpful: null,
          segmentOrder: null,
        }),
      });
    }
  });
}

// ── Script Approve (POST /api/v1/podcasts/*/script/approve) ─────────

export async function interceptScriptApprove(
  page: Page,
  podcastId: string
): Promise<void> {
  await page.route(
    `**/api/v1/podcasts/${podcastId}/script/approve`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }
  );
}
