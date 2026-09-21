import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { createNotificationSubscriber } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SSE endpoint for real-time notifications.
 * Subscribes to a Redis pub/sub channel for the authenticated user
 * and streams notification events as they arrive.
 *
 * EventSource sends cookies automatically, so session auth works.
 */
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { userId } = authed;
  if (request.signal.aborted)
    throw request.signal.reason ?? new DOMException('Request aborted', 'AbortError');
  const subscriber = createNotificationSubscriber(userId);

  const pendingMessages: string[] = [];
  let pendingSubscriberLoss: Error | undefined;
  let terminateForSubscriberLoss = (error: Error) => {
    pendingSubscriberLoss = error;
  };
  let deliverMessage: (data: string) => void = (data) => {
    pendingMessages.push(data);
  };
  try {
    await subscriber.subscribe((data) => deliverMessage(data), {
      signal: request.signal,
      onLoss: (error) => terminateForSubscriberLoss(error),
    });
    if (request.signal.aborted)
      throw request.signal.reason ?? new DOMException('Request aborted', 'AbortError');
  } catch (error) {
    try {
      await subscriber.cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Notification stream admission cleanup failed',
        {
          cause: error,
        }
      );
    }
    throw error;
  }

  let cleanupPromise: Promise<void> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let removeAbort = () => {};
  let terminated = false;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      clearInterval(keepalive);
      removeAbort();
      await subscriber.cleanup();
    })();
    return cleanupPromise;
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const terminate = (error?: unknown) => {
        if (terminated) return;
        terminated = true;
        void cleanup().then(
          () => {
            try {
              if (error === undefined) controller.close();
              else controller.error(error);
            } catch {
              // The consumer may already have closed the stream.
            }
          },
          (cleanupError) => {
            logger.warn('Notification stream cleanup failed', {
              userId,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
            try {
              controller.error(cleanupError);
            } catch {
              // The consumer may already have closed the stream.
            }
          }
        );
      };
      terminateForSubscriberLoss = terminate;
      if (pendingSubscriberLoss) {
        terminate(pendingSubscriberLoss);
        return;
      }

      controller.enqueue(encoder.encode(': connected\n\n'));

      deliverMessage = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          terminate();
        }
      };
      for (const message of pendingMessages.splice(0)) deliverMessage(message);

      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          terminate();
        }
      }, 30_000);

      const aborted = () => terminate(request.signal.reason);
      request.signal.addEventListener('abort', aborted, { once: true });
      removeAbort = () => request.signal.removeEventListener('abort', aborted);
      if (request.signal.aborted) aborted();
    },
    cancel() {
      terminated = true;
      return cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
