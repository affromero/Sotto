import { prisma } from './prisma';
import { addJob, JobType, audioGenerationQueue } from './queue';

/**
 * Create Segment records from script turns and queue audio generation jobs.
 * Shared by script-verification (no-refs path), reference-validation, and script approve endpoint.
 */
export async function createSegmentsAndQueueAudio(
  podcastId: string,
  turns: Array<{ speaker: string; text: string; direction?: string }>
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

    const previousText = i > 0 ? turns[i - 1].text.slice(-500) : undefined;
    const nextText = i < turns.length - 1 ? turns[i + 1].text.slice(0, 500) : undefined;

    await addJob(audioGenerationQueue, JobType.GENERATE_AUDIO, {
      podcastId,
      segmentId: segment.id,
      speaker: turns[i].speaker,
      text: turns[i].text,
      previousText,
      nextText,
      direction: turns[i].direction,
    }, { jobId: `audio-${podcastId}-${segment.id}` });
  }
}
