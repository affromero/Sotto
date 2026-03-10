import { Job } from 'bullmq';
import type { GenerateDemoVoiceoverPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { getPlatformTtsKey } from '@/lib/tts-generation';

export async function processDemoVoiceover(job: Job<GenerateDemoVoiceoverPayload>): Promise<void> {
  const { projectId, sceneId } = job.data;

  const scene = await prisma.demoScene.findUniqueOrThrow({
    where: { id: sceneId },
    select: { narration: true, ttsProvider: true, ttsModel: true, ttsVoiceId: true, projectId: true },
  });

  if (scene.projectId !== projectId) {
    throw new Error('Scene does not belong to project');
  }

  logger.info('Generating demo voiceover', { projectId, sceneId });
  await job.updateProgress(10);

  await prisma.demoScene.update({
    where: { id: sceneId },
    data: { voiceoverStatus: 'GENERATING', failedReason: null },
  });

  try {
    // Resolve TTS provider — use scene overrides or default to ElevenLabs
    const providerId = (scene.ttsProvider ?? 'elevenlabs') as TtsProviderId;
    const platformKey = getPlatformTtsKey(providerId);
    const provider = await createTtsProviderAsync(providerId, platformKey, undefined, scene.ttsModel ?? undefined);

    const voiceId = scene.ttsVoiceId ?? provider.getVoiceId('HOST', sceneId);

    await job.updateProgress(30);

    // Generate TTS audio
    const audioBuffer = await provider.generateSpeech({ text: scene.narration, voiceId });

    await job.updateProgress(70);

    // Upload to R2
    const r2Key = `demos/${projectId}/scenes/${sceneId}/voiceover.mp3`;
    const voiceoverUrl = await uploadFile(r2Key, audioBuffer, 'audio/mpeg');

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { voiceoverUrl, voiceoverStatus: 'READY' },
    });

    await job.updateProgress(100);
    logger.info('Demo voiceover complete', { projectId, sceneId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Demo voiceover failed', { projectId, sceneId, error: message });

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { voiceoverStatus: 'FAILED', failedReason: message },
    });

    throw err;
  }
}
