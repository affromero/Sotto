import { Job } from 'bullmq';
import { GenerateAudioPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { getVoiceId, getVoiceProfile } from '@/lib/elevenlabs';
import { createTtsProvider, createPremiumTtsProvider } from '@/lib/providers';
import { getElevenLabsPerKCharRate, getOpenAiPerKCharRate } from '@/lib/elevenlabs';
import { uploadSegmentAudio } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processAudioGeneration(job: Job<GenerateAudioPayload>): Promise<void> {
  const { podcastId, segmentId, speaker, text } = job.data;

  logger.info('Generating audio for segment', { podcastId, segmentId, speaker });
  await job.updateProgress(10);

  // Fetch podcast to determine voice configuration
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { userId: true, usePremiumVoice: true, hostVoiceId: true, expertVoiceId: true },
  });

  const startTime = Date.now();
  let audioBuffer: Buffer;
  let service: string;
  let voiceId: string;

  if (podcast.usePremiumVoice) {
    // Premium path: use ElevenLabs with custom or pool voice selection
    const customVoiceId = speaker === 'HOST' ? podcast.hostVoiceId : podcast.expertVoiceId;
    voiceId = customVoiceId || getVoiceId(speaker, podcastId);
    const profile = getVoiceProfile(voiceId);

    logger.info('Using premium voice (ElevenLabs)', {
      speaker,
      voiceName: profile?.name ?? 'custom',
      voiceId,
      podcastId,
    });

    const premiumProvider = createPremiumTtsProvider();
    audioBuffer = await premiumProvider.generateSpeech({ text, voiceId });
    service = 'elevenlabs';
  } else {
    // Standard path: use OpenAI TTS (default, 90% cheaper)
    const standardProvider = createTtsProvider('openai');
    voiceId = standardProvider.getVoiceId(speaker, podcastId);

    logger.info('Using standard voice (OpenAI)', {
      speaker,
      voiceId,
      podcastId,
    });

    audioBuffer = await standardProvider.generateSpeech({ text, voiceId });
    service = 'openai_tts';
  }

  const durationMs = Date.now() - startTime;

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(podcastId, segmentId, audioBuffer);

  // Update segment with audio URL
  await prisma.segment.update({
    where: { id: segmentId },
    data: { audioUrl },
  });

  // Log TTS cost
  const charCount = text.length;
  const costPerKChar = service === 'elevenlabs' ? getElevenLabsPerKCharRate() : getOpenAiPerKCharRate();
  const totalCost = (charCount / 1000) * costPerKChar;

  await prisma.apiUsageLog.create({
    data: {
      podcastId,
      userId: podcast.userId,
      service,
      category: 'audio_generation',
      inputTokens: charCount,
      totalCost,
      durationMs,
      metadata: { voiceId, speaker },
    },
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
  logger.info('Audio generation complete for segment', { podcastId, segmentId, service });
}
