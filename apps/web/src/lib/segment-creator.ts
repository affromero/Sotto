import type { Job } from 'bullmq';
import { Prisma } from '@/generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { audioGenerationQueue, JobType } from './queue';
import { admitDurableQueueBatch } from '@/lib/sidedoor/jobs/core/durable-queue';

type AudioSegment = { id: string; version: number; speaker: string; text: string };

export type AudioQueueAdmission =
  | { parentJob: Job<unknown> }
  | {
      authorize: (database: Prisma.TransactionClient) => Promise<{ userId?: string } | void>;
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
  const audioGenerationKey = randomUUID();
  await admitDurableQueueBatch({
    ...admission,
    prepare: async (database) => {
      await database.episode.update({
        where: { id: episodeId },
        data: { audioGenerationKey, status: 'GENERATING_AUDIO' },
      });
      const segments: AudioSegment[] = [];
      for (let index = 0; index < turns.length; index++) {
        const turn = turns[index]!;
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
        where: { episodeId, order: { gte: turns.length } },
      });
      return children(
        episodeId,
        audioGenerationKey,
        segments,
        turns.map((turn) => turn.direction)
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
      count = segments.length;
      return children(episodeId, audioGenerationKey, segments);
    },
  });
  return count;
}
