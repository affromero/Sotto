import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { checkAutoTweetThreshold } from '@/lib/twitter-auto-tweet';
import type { IngestEventsPayload } from '@/lib/queue';

/**
 * Event ingestion worker.
 * Processes batches of behavioral events:
 * 1. Upserts UserSession records
 * 2. Batch-inserts BehavioralEvent records
 * 3. Updates PlaybackSession aggregates from playback events
 */
export async function processEventIngestion(
  job: Job<IngestEventsPayload>
): Promise<{ processed: number }> {
  const { events } = job.data;

  if (!events || events.length === 0) {
    return { processed: 0 };
  }

  await job.updateProgress(10);

  // 1. Upsert user sessions
  const sessionMap = new Map<string, (typeof events)[0]['context']>();
  for (const event of events) {
    const existing = sessionMap.get(event.context.sessionId);
    if (!existing || event.context.clientTs > existing.clientTs) {
      sessionMap.set(event.context.sessionId, event.context);
    }
  }

  for (const [sessionId, ctx] of sessionMap) {
    try {
      await prisma.userSession.upsert({
        where: { sessionId },
        create: {
          sessionId,
          userId: ctx.userId,
          deviceType: ctx.deviceType,
          userAgent: ctx.userAgent?.slice(0, 512),
          referrer: ctx.referrer,
          pageCount: 1,
        },
        update: {
          lastSeenAt: new Date(),
          userId: ctx.userId || undefined,
          pageCount: {
            increment:
              events.filter(
                (e) => e.context.sessionId === sessionId && e.payload.eventType === 'page.view'
              ).length || 0,
          },
        },
      });
    } catch (err) {
      logger.error('Failed to upsert UserSession', { sessionId, error: (err as Error).message });
    }
  }

  await job.updateProgress(40);

  // 2. Batch-insert behavioral events
  const eventRecords = events.map((event) => {
    const { eventType, ...rest } = event.payload;
    const podcastId =
      'podcastId' in event.payload ? (event.payload.podcastId as string) : undefined;

    return {
      userId: event.context.userId,
      sessionId: event.context.sessionId,
      eventType,
      eventData: rest as object,
      podcastId,
      pageUrl: event.context.pageUrl,
      deviceType: event.context.deviceType,
      userAgent: event.context.userAgent?.slice(0, 512),
      referrer: event.context.referrer,
      clientTs: new Date(event.context.clientTs),
    };
  });

  try {
    await prisma.behavioralEvent.createMany({
      data: eventRecords,
    });
  } catch (err) {
    logger.error('Failed to batch-insert BehavioralEvents', {
      count: String(eventRecords.length),
      error: (err as Error).message,
    });
  }

  await job.updateProgress(70);

  // 3. Update PlaybackSession aggregates from playback events
  const playbackEvents = events.filter((e) => e.payload.eventType.startsWith('playback.'));

  for (const event of playbackEvents) {
    const podcastId =
      'podcastId' in event.payload ? (event.payload.podcastId as string) : undefined;
    if (!podcastId) continue;

    const sessionId = event.context.sessionId;
    const userId = event.context.userId;
    const eventType = event.payload.eventType;

    try {
      // Find or create playback session for this user+podcast+session combo
      let playbackSession = await prisma.playbackSession.findFirst({
        where: { sessionId, podcastId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });

      if (!playbackSession && eventType === 'playback.play') {
        playbackSession = await prisma.$transaction(async (tx) => {
          const session = await tx.playbackSession.create({
            data: { userId, sessionId, podcastId },
          });
          await tx.podcast.update({
            where: { id: podcastId },
            data: { playCount: { increment: 1 } },
          });
          return session;
        });

        // Fire-and-forget auto-tweet threshold check (after transaction committed)
        checkAutoTweetThreshold(podcastId).catch(() => {});
      }

      if (!playbackSession) continue;

      switch (eventType) {
        case 'playback.pause': {
          const data = event.payload as { listenedSinceLast?: number; position?: number };
          await prisma.playbackSession.update({
            where: { id: playbackSession.id },
            data: {
              pauseCount: { increment: 1 },
              totalListenSeconds: { increment: data.listenedSinceLast || 0 },
              maxPosition: Math.max(playbackSession.maxPosition, data.position || 0),
            },
          });
          break;
        }

        case 'playback.seek': {
          await prisma.playbackSession.update({
            where: { id: playbackSession.id },
            data: { seekCount: { increment: 1 } },
          });
          break;
        }

        case 'playback.speed_change': {
          const data = event.payload as { toSpeed?: number };
          await prisma.playbackSession.update({
            where: { id: playbackSession.id },
            data: {
              speedChanges: { increment: 1 },
              lastSpeed: data.toSpeed || playbackSession.lastSpeed,
            },
          });
          break;
        }

        case 'playback.heartbeat': {
          const data = event.payload as {
            cumulativeListenSeconds?: number;
            position?: number;
            speed?: number;
          };
          await prisma.playbackSession.update({
            where: { id: playbackSession.id },
            data: {
              totalListenSeconds:
                data.cumulativeListenSeconds || playbackSession.totalListenSeconds,
              maxPosition: Math.max(playbackSession.maxPosition, data.position || 0),
              lastSpeed: data.speed || playbackSession.lastSpeed,
            },
          });
          break;
        }

        case 'playback.complete': {
          const data = event.payload as { totalListenSeconds?: number };
          await prisma.playbackSession.update({
            where: { id: playbackSession.id },
            data: {
              endedAt: new Date(),
              totalListenSeconds: data.totalListenSeconds || playbackSession.totalListenSeconds,
              completionPercent: 100,
            },
          });
          break;
        }

        case 'playback.abandon': {
          const data = event.payload as {
            totalListenSeconds?: number;
            abandonPercent?: number;
            abandonPosition?: number;
            lastSpeed?: number;
            pauseCount?: number;
            seekCount?: number;
            speedChanges?: number;
            interactionCount?: number;
          };
          await prisma.playbackSession.update({
            where: { id: playbackSession.id },
            data: {
              endedAt: new Date(),
              totalListenSeconds: data.totalListenSeconds || playbackSession.totalListenSeconds,
              completionPercent: data.abandonPercent || playbackSession.completionPercent,
              maxPosition: Math.max(playbackSession.maxPosition, data.abandonPosition || 0),
              lastSpeed: data.lastSpeed || playbackSession.lastSpeed,
              pauseCount: data.pauseCount ?? playbackSession.pauseCount,
              seekCount: data.seekCount ?? playbackSession.seekCount,
              speedChanges: data.speedChanges ?? playbackSession.speedChanges,
              interruptCount: data.interactionCount ?? playbackSession.interruptCount,
            },
          });
          break;
        }
      }
    } catch (err) {
      logger.error('Failed to update PlaybackSession', {
        podcastId,
        eventType,
        error: (err as Error).message,
      });
    }
  }

  await job.updateProgress(100);
  logger.info('Event ingestion complete', { count: String(events.length) });
  return { processed: events.length };
}
