import { Job } from 'bullmq';
import { PassThrough } from 'stream';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getProviders } from '@/lib/providers';
import type { DataExportPayload } from '@/lib/queue';

const BATCH_SIZE = 1000;

/**
 * Data export worker.
 * Streams large result sets to JSONL or CSV files uploaded to R2.
 * Uses PassThrough + uploadStream to avoid buffering the entire export in memory.
 */
export async function processDataExport(job: Job<DataExportPayload>): Promise<{ fileUrl: string }> {
  const { exportType, dateFrom, dateTo, format } = job.data;

  const dateFilter = buildDateFilter(dateFrom, dateTo);

  await job.updateProgress(10);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = format === 'csv' ? 'csv' : 'jsonl';
  const filename = `exports/${exportType}_${timestamp}.${ext}`;

  const stream = new PassThrough();
  const storage = getProviders().storage;
  const uploadPromise = storage.uploadStream(
    filename,
    stream,
    `text/${ext === 'csv' ? 'csv' : 'plain'}`
  );

  let lineCount = 0;
  const writeLine = (line: string) => {
    stream.write(line + '\n');
    lineCount++;
  };

  switch (exportType) {
    case 'playback_sessions':
      await exportPlaybackSessions(dateFilter, format, writeLine);
      break;
    case 'behavioral_events':
      await exportBehavioralEvents(dateFilter, format, writeLine);
      break;
    case 'user_features':
      await exportUserFeatures(format, writeLine);
      break;
    case 'podcast_features':
      await exportPodcastFeatures(format, writeLine);
      break;
    case 'interactions':
      await exportInteractions(dateFilter, format, writeLine);
      break;
    case 'training_pairs':
      await exportTrainingPairs(dateFilter, format, writeLine);
      break;
  }

  await job.updateProgress(80);

  stream.end();
  const fileUrl = await uploadPromise;

  await job.updateProgress(100);
  logger.info('Data export complete', {
    exportType,
    format,
    lines: String(lineCount),
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
  format: string,
  writeLine: (line: string) => void
): Promise<void> {
  if (format === 'csv') {
    writeLine(
      'id,userId,sessionId,podcastId,startedAt,endedAt,totalListenSeconds,maxPosition,completionPercent,pauseCount,seekCount,speedChanges,lastSpeed,interruptCount'
    );
  }

  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.playbackSession.findMany({
      where: dateFilter.gte || dateFilter.lte ? { startedAt: dateFilter } : {},
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const session of batch) {
      if (format === 'csv') {
        writeLine(
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
        writeLine(JSON.stringify(session));
      }
    }

    if (batch.length < BATCH_SIZE) break;
    cursor = batch[batch.length - 1].id;
  }
}

async function exportBehavioralEvents(
  dateFilter: { gte?: Date; lte?: Date },
  format: string,
  writeLine: (line: string) => void
): Promise<void> {
  if (format === 'csv') {
    writeLine('id,createdAt,userId,sessionId,eventType,podcastId,pageUrl,deviceType');
  }

  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.behavioralEvent.findMany({
      where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {},
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const event of batch) {
      if (format === 'csv') {
        writeLine(
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
        writeLine(JSON.stringify(event));
      }
    }

    if (batch.length < BATCH_SIZE) break;
    cursor = batch[batch.length - 1].id;
  }
}

async function exportUserFeatures(
  format: string,
  writeLine: (line: string) => void
): Promise<void> {
  if (format === 'csv') {
    writeLine(
      'userId,totalListenMinutes,totalPodcastsListened,avgCompletionRate,avgListenSpeed,avgAbandonPercent,optimalDuration,archetype,speakerPreference,noveltyResponseRate,creatorLoyalty'
    );
  }

  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.userFeature.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const f of batch) {
      if (format === 'csv') {
        writeLine(
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
        writeLine(JSON.stringify(f));
      }
    }

    if (batch.length < BATCH_SIZE) break;
    cursor = batch[batch.length - 1].id;
  }
}

async function exportPodcastFeatures(
  format: string,
  writeLine: (line: string) => void
): Promise<void> {
  if (format === 'csv') {
    writeLine(
      'podcastId,avgCompletionRate,medianCompletionRate,totalUniqueListeners,totalListenMinutes,likeToListenRatio,saveToListenRatio,forkToListenRatio,interactionRate,relistenRate,avgListenSpeed,segmentCount,durationSeconds,referenceCount,verifiedReferenceRate'
    );
  }

  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.podcastFeature.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const f of batch) {
      if (format === 'csv') {
        writeLine(
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
        writeLine(JSON.stringify(f));
      }
    }

    if (batch.length < BATCH_SIZE) break;
    cursor = batch[batch.length - 1].id;
  }
}

async function exportInteractions(
  dateFilter: { gte?: Date; lte?: Date },
  format: string,
  writeLine: (line: string) => void
): Promise<void> {
  if (format === 'csv') {
    writeLine('id,podcastId,userId,question,timestamp,answer,status,resolved,incorporated');
  }

  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.interaction.findMany({
      where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {},
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const i of batch) {
      if (format === 'csv') {
        writeLine(
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
        writeLine(JSON.stringify(i));
      }
    }

    if (batch.length < BATCH_SIZE) break;
    cursor = batch[batch.length - 1].id;
  }
}

async function exportTrainingPairs(
  dateFilter: { gte?: Date; lte?: Date },
  format: string,
  writeLine: (line: string) => void
): Promise<void> {
  if (format === 'csv') {
    writeLine('userId,podcastId,completionPercent,saved,trainingLabel');
  }

  let cursor: string | undefined;
  while (true) {
    const sessions = await prisma.playbackSession.findMany({
      where: {
        userId: { not: null },
        ...(dateFilter.gte || dateFilter.lte ? { startedAt: dateFilter } : {}),
      },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const session of sessions) {
      if (!session.userId) continue;

      const saved = await prisma.save.findUnique({
        where: { userId_podcastId: { userId: session.userId, podcastId: session.podcastId } },
      });

      const label = session.completionPercent >= 50 || saved ? 'positive' : 'negative';

      if (format === 'csv') {
        writeLine(
          [
            session.userId,
            session.podcastId,
            session.completionPercent,
            saved ? 'true' : 'false',
            label,
          ].join(',')
        );
      } else {
        writeLine(
          JSON.stringify({
            userId: session.userId,
            podcastId: session.podcastId,
            completionPercent: session.completionPercent,
            saved: !!saved,
            trainingLabel: label,
          })
        );
      }
    }

    if (sessions.length < BATCH_SIZE) break;
    cursor = sessions[sessions.length - 1].id;
  }
}
