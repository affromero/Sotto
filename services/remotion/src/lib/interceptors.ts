/**
 * API interceptors for browser recording.
 * Adapted from scripts/recording/lib/interceptors.ts for use in the Remotion sidecar.
 */
import type { Page, Route } from 'playwright';

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** Set up a named interceptor on the page. */
export async function setupInterceptor(
  page: Page,
  name: string,
  options: Record<string, unknown>,
): Promise<void> {
  switch (name) {
    case 'discovery':
      await interceptDiscovery(page, options);
      break;
    case 'interact':
      await interceptInteract(page, options);
      break;
    case 'fork':
      await interceptFork(page, options);
      break;
    case 'scriptApprove':
      await interceptScriptApprove(page, options);
      break;
    case 'avatar':
      await interceptAvatar(page, options);
      break;
    default:
      console.warn(`Unknown interceptor: ${name}`);
  }
}

/** Remove a named interceptor. */
export async function clearInterceptor(page: Page, name: string): Promise<void> {
  switch (name) {
    case 'discovery':
      await page.unroute('**/api/discovery');
      break;
    case 'interact':
      // Interact uses two routes — unroute both patterns
      await page.unroute('**/api/podcasts/*/interact');
      await page.unroute('**/api/podcasts/*/interact/*');
      break;
    case 'fork':
      await page.unroute('**/api/podcasts/*/fork');
      break;
    case 'scriptApprove':
      await page.unroute('**/api/podcasts/*/script/approve');
      break;
    case 'avatar':
      await page.unroute('**/api/podcasts/*/avatar/session');
      break;
    default:
      console.warn(`Unknown interceptor to clear: ${name}`);
  }
}

async function interceptDiscovery(
  page: Page,
  options: Record<string, unknown>,
): Promise<void> {
  const textChunks = (options.textChunks as string[]) ?? ['Welcome to Sotto!'];
  const chips = (options.chips as string[]) ?? [];
  const metadata = (options.metadata as Record<string, unknown>) ?? {};

  await page.route('**/api/discovery', async (route: Route) => {
    let body = '';
    for (const text of textChunks) {
      body += sseEvent({ text });
    }
    body += sseEvent({ done: true, chips, metadata });

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

async function interceptInteract(
  page: Page,
  options: Record<string, unknown>,
): Promise<void> {
  const podcastId = options.podcastId as string;
  const interactionId = options.interactionId as string;
  const answer = options.answer as string;
  const answerDelay = (options.answerDelay as number) ?? 1500;

  const postPattern = `**/api/podcasts/${podcastId}/interact`;
  const pollPattern = `**/api/podcasts/${podcastId}/interact/${interactionId}`;

  await page.route(postPattern, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: interactionId,
        podcastId,
        question: 'mock question',
        timestamp: 60,
        status: 'PENDING',
        user: { id: 'mock-user', name: 'Demo User', image: null },
      }),
    });
  });

  let pollCount = 0;
  const pollsBeforeAnswer = Math.max(1, Math.ceil(answerDelay / 500));

  await page.route(pollPattern, async (route: Route) => {
    pollCount++;
    const status = pollCount >= pollsBeforeAnswer ? 'ANSWERED' : 'PENDING';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: interactionId,
        question: 'mock question',
        timestamp: 60,
        status,
        answer: status === 'ANSWERED' ? answer : null,
        helpful: null,
        segmentOrder: null,
      }),
    });
  });
}

async function interceptFork(
  page: Page,
  options: Record<string, unknown>,
): Promise<void> {
  const podcastId = options.podcastId as string;
  const forkId = options.forkId as string;

  await page.route(`**/api/podcasts/${podcastId}/fork`, async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: forkId }),
    });
  });
}

async function interceptScriptApprove(
  page: Page,
  options: Record<string, unknown>,
): Promise<void> {
  const podcastId = options.podcastId as string;

  await page.route(
    `**/api/podcasts/${podcastId}/script/approve`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    },
  );
}

/**
 * Avatar interceptor — makes the avatar session API return instantly with
 * a pre-generated video URL, skipping all generation wait time during recording.
 */
async function interceptAvatar(
  page: Page,
  options: Record<string, unknown>,
): Promise<void> {
  const podcastId = options.podcastId as string;
  const videoUrl = options.videoUrl as string;

  await page.route(
    `**/api/podcasts/${podcastId}/avatar/session`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'READY',
          videoUrl,
        }),
      });
    },
  );
}
