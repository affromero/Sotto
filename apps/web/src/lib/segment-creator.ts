import type { Job } from 'bullmq';
import { Prisma } from '@/generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { audioGenerationQueue, JobType } from './queue';
import { admitDurableQueueBatch } from '@/lib/sidedoor/jobs/core/durable-queue';

type AudioSegment = { id: string; version: number; speaker: string; text: string };

export type AudioQueueAdmission = (
  | { parentJob: Job<unknown> }
  | {
      authorize: (database: Prisma.TransactionClient) => Promise<{ userId?: string } | void>;
    }
) & {
  onPrepared?: (database: Prisma.TransactionClient, audioGenerationKey: string) => Promise<void>;
  reservation?: {
    generationKey: string;
    reconcile: (
      database: Prisma.TransactionClient,
      generationKey: string
    ) => Promise<'CREATE' | 'REPLAY'>;
  };
};

function children(
  episodeId: string,
  audioGenerationKey: string,
  segments: AudioSegment[],
  directions: Array<string | undefined> = []
) {
  return segments.map((segment, index) => ({
    queue: audioGenerationQueue,
    type: JobType.GENERATE_AUDIO,
    payload: {
      episodeId,
      audioGenerationKey,
      segmentId: segment.id,
      segmentVersion: segment.version,
      speaker: segment.speaker,
      text: segment.text,
      previousText: index > 0 ? segments[index - 1]!.text.slice(-500) : undefined,
      nextText: index < segments.length - 1 ? segments[index + 1]!.text.slice(0, 500) : undefined,
      direction: directions[index],
    },
    jobId: `audio-${episodeId}-${segment.id}-v${segment.version}-${audioGenerationKey}`,
  }));
}

/** Commit segment replacement, every audio child, and parent completion together. */
export async function createSegmentsAndQueueAudio(
  episodeId: string,
  turns: Array<{ speaker: string; text: string; direction?: string }>,
  admission: AudioQueueAdmission
): Promise<void> {
  const capturedTurns = structuredClone(turns);
  const audioGenerationKey = admission.reservation?.generationKey ?? randomUUID();
  const { onPrepared, reservation, ...authority } = admission;
  const reconcile = reservation?.reconcile;
  if (!audioGenerationKey.trim()) throw new Error('Audio generation key is required');
  await admitDurableQueueBatch({
    ...authority,
    prepare: async (database) => {
      const mode = reconcile ? await reconcile(database, audioGenerationKey) : 'CREATE';
      if (mode !== 'CREATE' && mode !== 'REPLAY')
        throw new Error('Invalid audio reservation state');
      if (mode === 'REPLAY') {
        const episode = await database.episode.findUniqueOrThrow({
          where: { id: episodeId },
          select: { audioGenerationKey: true, status: true },
        });
        const segments = await database.segment.findMany({
          where: { episodeId },
          orderBy: { order: 'asc' },
          select: { id: true, version: true, order: true, speaker: true, text: true },
        });
        if (
          episode.audioGenerationKey !== audioGenerationKey ||
          !['GENERATING_AUDIO', 'STITCHING', 'READY'].includes(episode.status) ||
          segments.length !== capturedTurns.length ||
          segments.some(
            (segment, index) =>
              segment.order !== index ||
              segment.speaker !== capturedTurns[index]?.speaker ||
              segment.text !== capturedTurns[index]?.text
          )
        )
          throw new Error('The reserved audio generation changed');
        await onPrepared?.(database, audioGenerationKey);
        return children(
          episodeId,
          audioGenerationKey,
          segments,
          capturedTurns.map((turn) => turn.direction)
        ).map((child) => ({ ...child, existingOnly: true }));
      }
      await database.episode.update({
        where: { id: episodeId },
        data: { audioGenerationKey, status: 'GENERATING_AUDIO' },
      });
      await onPrepared?.(database, audioGenerationKey);
      const segments: AudioSegment[] = [];
      for (let index = 0; index < capturedTurns.length; index++) {
        const turn = capturedTurns[index]!;
        segments.push(
          await database.segment.upsert({
            where: { episodeId_order: { episodeId, order: index } },
            create: { episodeId, speaker: turn.speaker, text: turn.text, order: index },
            update: {
              speaker: turn.speaker,
              text: turn.text,
              version: { increment: 1 },
              audioUrl: null,
              duration: null,
              startTime: null,
              wordTimings: Prisma.JsonNull,
            },
            select: { id: true, version: true, speaker: true, text: true },
          })
        );
      }
      await database.segment.deleteMany({
        where: { episodeId, order: { gte: capturedTurns.length } },
      });
      return children(
        episodeId,
        audioGenerationKey,
        segments,
        capturedTurns.map((turn) => turn.direction)
      );
    },
  });
}

/** Commit a coherent segment reset and every replacement child together. */
export async function restartExistingSegmentAudio(
  episodeId: string,
  audioGenerationKey: string,
  admission: AudioQueueAdmission
): Promise<number> {
  let count = 0;
  await admitDurableQueueBatch({
    ...admission,
    distinguishDeliveryFailure: true,
    prepare: async (database) => {
      const existing = await database.segment.findMany({
        where: { episodeId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      if (existing.length === 0)
        throw new Error(`Episode ${episodeId} has no segments to regenerate`);
      const segments: AudioSegment[] = [];
      for (const { id } of existing)
        segments.push(
          await database.segment.update({
            where: { id },
            data: {
              version: { increment: 1 },
              audioUrl: null,
              duration: null,
              startTime: null,
              wordTimings: Prisma.JsonNull,
            },
            select: { id: true, version: true, speaker: true, text: true },
          })
        );
      await admission.onPrepared?.(database, audioGenerationKey);
      count = segments.length;
      return children(episodeId, audioGenerationKey, segments);
    },
  });
  return count;
}
