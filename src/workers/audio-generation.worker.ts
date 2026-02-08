import { Job } from 'bullmq';
import { GenerateAudioPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { generateSpeech, getVoiceId, getVoiceProfile } from '@/lib/elevenlabs';
import { uploadSegmentAudio } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processAudioGeneration(job: Job<GenerateAudioPayload>): Promise<void> {
  const { podcastId, segmentId, speaker, text } = job.data;

  logger.info('Generating audio for segment', { podcastId, segmentId, speaker });
  await job.updateProgress(10);

  // Select voice from the diverse pool, seeded by podcast ID for consistency
  const voiceId = getVoiceId(speaker, podcastId);
  const profile = getVoiceProfile(voiceId);
  logger.info('Voice selected', {
    speaker,
    voiceName: profile?.name ?? 'custom',
    voiceId,
    podcastId,
  });

  const audioBuffer = await generateSpeech({ text, voiceId });

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(podcastId, segmentId, audioBuffer);

  // Update segment with audio URL
  await prisma.segment.update({
    where: { id: segmentId },
    data: { audioUrl },
  });

  await job.updateProgress(90);

  // Check if all segments for this podcast are done
  const pendingSegments = await prisma.segment.count({
    where: { podcastId, audioUrl: null },
  });

  if (pendingSegments === 0) {
    // All segments generated — queue stitching
    const segments = await prisma.segment.findMany({
      where: { podcastId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
      podcastId,
      segmentIds: segments.map((s) => s.id),
    });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'STITCHING' },
    });
  }

  await job.updateProgress(100);
  logger.info('Audio generation complete for segment', { podcastId, segmentId });
}
