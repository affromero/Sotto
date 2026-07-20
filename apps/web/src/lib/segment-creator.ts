import { prisma } from './prisma';
import { addJob, JobType, audioGenerationQueue } from './queue';
import { Prisma } from '@/generated/prisma/client';
import { randomUUID } from 'crypto';

type AudioSegment = {
  id: string;
  version: number;
  speaker: string;
  text: string;
};

async function queueAudioAttempt(
  episodeId: string,
  audioGenerationKey: string,
  segments: AudioSegment[],
  directions: Array<string | undefined> = []
): Promise<void> {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const previousText = i > 0 ? segments[i - 1].text.slice(-500) : undefined;
    const nextText = i < segments.length - 1 ? segments[i + 1].text.slice(0, 500) : undefined;

    await addJob(
      audioGenerationQueue,
      JobType.GENERATE_AUDIO,
      {
        episodeId,
        audioGenerationKey,
        segmentId: segment.id,
        segmentVersion: segment.version,
        speaker: segment.speaker,
        text: segment.text,
        previousText,
        nextText,
        direction: directions[i],
      },
      { jobId: `audio-${episodeId}-${segment.id}-v${segment.version}-${audioGenerationKey}` }
    );
  }
}

/**
 * Create Segment records from script turns and queue audio generation jobs.
 * Shared by the compile-script worker, the class listening generator, and the
 * script approve endpoint.
 */
export async function createSegmentsAndQueueAudio(
  episodeId: string,
  turns: Array<{ speaker: string; text: string; direction?: string }>
): Promise<void> {
  const audioGenerationKey = randomUUID();
  await prisma.episode.update({
    where: { id: episodeId },
    data: { audioGenerationKey },
  });

  const segments = await prisma.$transaction(async (tx) => {
    const reconciled = [];
    for (let i = 0; i < turns.length; i++) {
      const segment = await tx.segment.upsert({
        where: { episodeId_order: { episodeId, order: i } },
        create: {
          episodeId,
          speaker: turns[i].speaker,
          text: turns[i].text,
          order: i,
        },
        update: {
          speaker: turns[i].speaker,
          text: turns[i].text,
          version: { increment: 1 },
          audioUrl: null,
          duration: null,
          startTime: null,
          wordTimings: Prisma.JsonNull,
        },
      });
      reconciled.push(segment);
    }

    await tx.segment.deleteMany({
      where: { episodeId, order: { gte: turns.length } },
    });

    return reconciled;
  });

  await queueAudioAttempt(
    episodeId,
    audioGenerationKey,
    segments,
    turns.map((turn) => turn.direction)
  );
}

/**
 * Start a coherent replacement attempt for an existing segment set. All
 * previous audio is invalidated so provider or voice changes cannot produce a
 * mixed episode.
 */
export async function restartExistingSegmentAudio(
  episodeId: string,
  audioGenerationKey: string
): Promise<number> {
  const segments = await prisma.$transaction(async (tx) => {
    const existing = await tx.segment.findMany({
      where: { episodeId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    const reset = [];
    for (const { id } of existing) {
      reset.push(
        await tx.segment.update({
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
    }
    return reset;
  });

  if (segments.length === 0) {
    throw new Error(`Episode ${episodeId} has no segments to regenerate`);
  }

  await queueAudioAttempt(episodeId, audioGenerationKey, segments);
  return segments.length;
}
