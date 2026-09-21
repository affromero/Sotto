import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { createEpisodeStatusSubscriber } from '@/lib/redis';
import { openSottoSemaphore } from '@/lib/sidedoor/jobs/core/redis-semaphore';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ episodeId: string }> };
type CapacitySession = Awaited<ReturnType<typeof openSottoSemaphore>>;

async function releaseCapacity(sessions: readonly CapacitySession[]): Promise<void> {
  const settled = await Promise.allSettled(sessions.map((session) => session.release()));
  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, 'Episode stream capacity cleanup failed');
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { episodeId } = await params;
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true },
  });
  if (!episode) {
    return new Response('Not found', { status: 404 });
  }
  if (episode.userId !== authenticated.userId && !(await isUserAdmin(authenticated))) {
    return new Response('Forbidden', { status: 403 });
  }

  const sessions: CapacitySession[] = [];
  let subscriber: ReturnType<typeof createEpisodeStatusSubscriber>;
  const throwIfAborted = () => {
    if (request.signal.aborted)
      throw request.signal.reason ?? new DOMException('Request aborted', 'AbortError');
  };
  try {
    throwIfAborted();
    const userCapacity = await openSottoSemaphore({
      resource: `sse:episode:user:${authenticated.userId}`,
      limit: 5,
      ttlMs: 3_600_000,
    });
    sessions.push(userCapacity);
    throwIfAborted();
    if (!(await userCapacity.acquire())) {
      await releaseCapacity(sessions);
      return new Response('Too many active streams', { status: 429 });
    }
    throwIfAborted();
    const globalCapacity = await openSottoSemaphore({
      resource: 'sse:episode:global',
      limit: 100,
      ttlMs: 3_600_000,
    });
    sessions.push(globalCapacity);
    throwIfAborted();
    if (!(await globalCapacity.acquire())) {
      await releaseCapacity(sessions);
      return new Response('Too many active streams', { status: 503 });
    }
    throwIfAborted();
    subscriber = createEpisodeStatusSubscriber(episodeId);
  } catch (error) {
    try {
      await releaseCapacity(sessions);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Episode stream admission cleanup failed', {
        cause: error,
      });
    }
    throw error;
  }

  let cleanupPromise: Promise<void> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let renewal: ReturnType<typeof setInterval> | undefined;
  let removeAbort = () => {};
  let terminated = false;
  let pendingSubscriberLoss: Error | undefined;
  let terminateForSubscriberLoss = (error: Error) => {
    pendingSubscriberLoss = error;
  };
  const pendingMessages: string[] = [];
  let deliverMessage: (data: string) => void = (data) => {
    pendingMessages.push(data);
  };
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      clearInterval(keepalive);
      clearInterval(renewal);
      removeAbort();
      const settled = await Promise.allSettled([subscriber.cleanup(), releaseCapacity(sessions)]);
      const failures = settled
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length)
        throw new AggregateError(failures, 'Episode status stream cleanup failed');
    })();
    return cleanupPromise;
  };
  try {
    await subscriber.subscribe((data) => deliverMessage(data), {
      signal: request.signal,
      onLoss: (error) => terminateForSubscriberLoss(error),
    });
    throwIfAborted();
  } catch (error) {
    const settled = await Promise.allSettled([subscriber.cleanup(), releaseCapacity(sessions)]);
    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError([error, ...failures], 'Episode stream subscription cleanup failed', {
        cause: error,
      });
    throw error;
  }

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
            logger.warn('Episode status stream cleanup failed', {
              episodeId,
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
      renewal = setInterval(() => {
        void Promise.all(sessions.map((session) => session.renew())).then((renewed) => {
          if (renewed.some((value) => !value))
            terminate(new Error('Episode stream capacity expired'));
        }, terminate);
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
