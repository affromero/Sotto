import { prisma } from './prisma';
import { addJob, JobType, audioGenerationQueue } from './queue';

/**
 * Create Segment records from script turns and queue audio generation jobs.
 * Shared by script-verification (no-refs path), reference-validation, and script approve endpoint.
 */
export async function createSegmentsAndQueueAudio(
  podcastId: string,
  turns: Array<{ speaker: string; text: string }>
): Promise<void> {
  for (let i = 0; i < turns.length; i++) {
    const segment = await prisma.segment.create({
      data: {
        podcastId,
        speaker: turns[i].speaker,
        text: turns[i].text,
        order: i,
      },
    });

    await addJob(audioGenerationQueue, JobType.GENERATE_AUDIO, {
      podcastId,
      segmentId: segment.id,
      speaker: turns[i].speaker,
      text: turns[i].text,
    });
  }
}
