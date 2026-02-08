import { Job } from 'bullmq';
import { RegenerateSegmentPayload } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { generateSpeech, getVoiceId } from '@/lib/elevenlabs';
import { uploadSegmentAudio } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processSegmentRegeneration(
  job: Job<RegenerateSegmentPayload>
): Promise<void> {
  const { podcastId, interactionId, insertAfterOrder, newText, speaker } = job.data;

  logger.info('Regenerating segment', { podcastId, interactionId });
  await job.updateProgress(10);

  // Create new segment
  const segment = await prisma.segment.create({
    data: {
      podcastId,
      speaker,
      text: newText,
      order: insertAfterOrder + 0.5, // Will be reordered
    },
  });

  // Generate audio
  const voiceId = getVoiceId(speaker);
  const audioBuffer = await generateSpeech({ text: newText, voiceId });
  const audioUrl = await uploadSegmentAudio(podcastId, segment.id, audioBuffer);

  await prisma.segment.update({
    where: { id: segment.id },
    data: { audioUrl },
  });

  await job.updateProgress(70);

  // Reorder all segments
  const allSegments = await prisma.segment.findMany({
    where: { podcastId },
    orderBy: { order: 'asc' },
  });

  for (let i = 0; i < allSegments.length; i++) {
    await prisma.segment.update({
      where: { id: allSegments[i].id },
      data: { order: i },
    });
  }

  // Mark interaction as incorporated
  await prisma.interaction.update({
    where: { id: interactionId },
    data: { status: 'INCORPORATED', incorporated: true },
  });

  // Update podcast status back to READY
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'READY' },
  });

  await job.updateProgress(100);
  logger.info('Segment regeneration complete', { podcastId, segmentId: segment.id });
}
