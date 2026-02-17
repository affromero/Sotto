import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getProviders } from '@/lib/providers';
import type { DataExportPayload } from '@/lib/queue';

const BATCH_SIZE = 1000;

/**
 * Data export worker.
 * Streams large result sets to JSONL or CSV files uploaded to R2.
 */
export async function processDataExport(job: Job<DataExportPayload>): Promise<{ fileUrl: string }> {
  const { exportType, dateFrom, dateTo, format } = job.data;

  const dateFilter = buildDateFilter(dateFrom, dateTo);
  let lines: string[] = [];

  await job.updateProgress(10);

  switch (exportType) {
    case 'playback_sessions':
      lines = await exportPlaybackSessions(dateFilter, format);
      break;
    case 'behavioral_events':
      lines = await exportBehavioralEvents(dateFilter, format);
      break;
    case 'user_features':
      lines = await exportUserFeatures(format);
      break;
    case 'podcast_features':
      lines = await exportPodcastFeatures(format);
      break;
    case 'interactions':
      lines = await exportInteractions(dateFilter, format);
      break;
    case 'training_pairs':
      lines = await exportTrainingPairs(dateFilter, format);
      break;
  }

  await job.updateProgress(80);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = format === 'csv' ? 'csv' : 'jsonl';
  const filename = `exports/${exportType}_${timestamp}.${ext}`;
  const content = lines.join('\n');

  const storage = getProviders().storage;
  const fileUrl = await storage.uploadFile(
    filename,
    Buffer.from(content, 'utf-8'),
    `text/${ext === 'csv' ? 'csv' : 'plain'}`
  );

  await job.updateProgress(100);
  logger.info('Data export complete', {
    exportType,
    format,
    lines: String(lines.length),
    filename,
  });
  return { fileUrl };
}

function buildDateFilter(from?: string, to?: string): { gte?: Date; lte?: Date } {
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = new Date(from);
  if (to) filter.lte = new Date(to);
  return filter;
}

async function exportPlaybackSessions(
  dateFilter: { gte?: Date; lte?: Date },
  format: string
): Promise<string[]> {
  const lines: string[] = [];

  if (format === 'csv') {
    lines.push(
      'id,userId,sessionId,podcastId,startedAt,endedAt,totalListenSeconds,maxPosition,completionPercent,pauseCount,seekCount,speedChanges,lastSpeed,interruptCount'
    );
  }

  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await prisma.playbackSession.findMany({
      where: dateFilter.gte || dateFilter.lte ? { startedAt: dateFilter } : {},
      skip,
      take: BATCH_SIZE,
      orderBy: { startedAt: 'asc' },
    });

    for (const session of batch) {
      if (format === 'csv') {
        lines.push(
          [
            session.id,
            session.userId || '',
            session.sessionId,
            session.podcastId,
            session.startedAt.toISOString(),
            session.endedAt?.toISOString() || '',
            session.totalListenSeconds,
            session.maxPosition,
            session.completionPercent,
            session.pauseCount,
            session.seekCount,
            session.speedChanges,
            session.lastSpeed,
            session.interruptCount,
          ].join(',')
        );
      } else {
        lines.push(JSON.stringify(session));
      }
    }

    skip += BATCH_SIZE;
    hasMore = batch.length === BATCH_SIZE;
  }

  return lines;
}

async function exportBehavioralEvents(
  dateFilter: { gte?: Date; lte?: Date },
  format: string
): Promise<string[]> {
  const lines: string[] = [];

  if (format === 'csv') {
    lines.push('id,createdAt,userId,sessionId,eventType,podcastId,pageUrl,deviceType');
  }

  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await prisma.behavioralEvent.findMany({
      where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {},
      skip,
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    for (const event of batch) {
      if (format === 'csv') {
        lines.push(
          [
            event.id,
            event.createdAt.toISOString(),
            event.userId || '',
            event.sessionId,
            event.eventType,
            event.podcastId || '',
            event.pageUrl || '',
            event.deviceType || '',
          ].join(',')
        );
      } else {
        lines.push(JSON.stringify(event));
      }
    }

    skip += BATCH_SIZE;
    hasMore = batch.length === BATCH_SIZE;
  }

  return lines;
}

async function exportUserFeatures(format: string): Promise<string[]> {
  const lines: string[] = [];
  const features = await prisma.userFeature.findMany();

  if (format === 'csv') {
    lines.push(
      'userId,totalListenMinutes,totalPodcastsListened,avgCompletionRate,avgListenSpeed,avgAbandonPercent,optimalDuration,archetype,speakerPreference,noveltyResponseRate,creatorLoyalty'
    );
  }

  for (const f of features) {
    if (format === 'csv') {
      lines.push(
        [
          f.userId,
          f.totalListenMinutes,
          f.totalPodcastsListened,
          f.avgCompletionRate,
          f.avgListenSpeed,
          f.avgAbandonPercent,
          f.optimalDuration,
          f.archetype || '',
          f.speakerPreference,
          f.noveltyResponseRate,
          f.creatorLoyalty,
        ].join(',')
      );
    } else {
      lines.push(JSON.stringify(f));
    }
  }

  return lines;
}

async function exportPodcastFeatures(format: string): Promise<string[]> {
  const lines: string[] = [];
  const features = await prisma.podcastFeature.findMany();

  if (format === 'csv') {
    lines.push(
      'podcastId,avgCompletionRate,medianCompletionRate,totalUniqueListeners,totalListenMinutes,likeToListenRatio,saveToListenRatio,forkToListenRatio,interactionRate,relistenRate,avgListenSpeed,segmentCount,durationSeconds,referenceCount,verifiedReferenceRate'
    );
  }

  for (const f of features) {
    if (format === 'csv') {
      lines.push(
        [
          f.podcastId,
          f.avgCompletionRate,
          f.medianCompletionRate,
          f.totalUniqueListeners,
          f.totalListenMinutes,
          f.likeToListenRatio,
          f.saveToListenRatio,
          f.forkToListenRatio,
          f.interactionRate,
          f.relistenRate,
          f.avgListenSpeed,
          f.segmentCount,
          f.durationSeconds,
          f.referenceCount,
          f.verifiedReferenceRate,
        ].join(',')
      );
    } else {
      lines.push(JSON.stringify(f));
    }
  }

  return lines;
}

async function exportInteractions(
  dateFilter: { gte?: Date; lte?: Date },
  format: string
): Promise<string[]> {
  const lines: string[] = [];

  if (format === 'csv') {
    lines.push('id,podcastId,userId,question,timestamp,answer,status,resolved,incorporated');
  }

  const interactions = await prisma.interaction.findMany({
    where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {},
    orderBy: { createdAt: 'asc' },
  });

  for (const i of interactions) {
    if (format === 'csv') {
      lines.push(
        [
          i.id,
          i.podcastId,
          i.userId,
          `"${i.question.replace(/"/g, '""')}"`,
          i.timestamp,
          `"${(i.answer || '').replace(/"/g, '""')}"`,
          i.status,
          i.resolved,
          i.incorporated,
        ].join(',')
      );
    } else {
      lines.push(JSON.stringify(i));
    }
  }

  return lines;
}

async function exportTrainingPairs(
  dateFilter: { gte?: Date; lte?: Date },
  format: string
): Promise<string[]> {
  const lines: string[] = [];

  if (format === 'csv') {
    lines.push('userId,podcastId,completionPercent,liked,saved,engagementLabel');
  }

  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const sessions = await prisma.playbackSession.findMany({
      where: {
        userId: { not: null },
        ...(dateFilter.gte || dateFilter.lte ? { startedAt: dateFilter } : {}),
      },
      skip,
      take: BATCH_SIZE,
      orderBy: { startedAt: 'asc' },
    });

    for (const session of sessions) {
      if (!session.userId) continue;

      const [liked, saved] = await Promise.all([
        prisma.like.findUnique({
          where: { userId_podcastId: { userId: session.userId, podcastId: session.podcastId } },
        }),
        prisma.save.findUnique({
          where: { userId_podcastId: { userId: session.userId, podcastId: session.podcastId } },
        }),
      ]);

      // Engagement label: positive (completed 50%+ or liked/saved), negative otherwise
      const label = session.completionPercent >= 50 || liked || saved ? 'positive' : 'negative';

      if (format === 'csv') {
        lines.push(
          [
            session.userId,
            session.podcastId,
            session.completionPercent,
            liked ? 'true' : 'false',
            saved ? 'true' : 'false',
            label,
          ].join(',')
        );
      } else {
        lines.push(
          JSON.stringify({
            userId: session.userId,
            podcastId: session.podcastId,
            completionPercent: session.completionPercent,
            liked: !!liked,
            saved: !!saved,
            engagementLabel: label,
          })
        );
      }
    }

    skip += BATCH_SIZE;
    hasMore = sessions.length === BATCH_SIZE;
  }

  return lines;
}
