import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { SpeakingGradingPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getAiKey } from '@/lib/byok';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { resolveSttProvider, createSttProvider } from '@/lib/providers/stt';
import { resolvePronunciationScorer } from '@/lib/pronunciation/scorer';
import { logger } from '@/lib/logger';

export async function processSpeakingGrading(job: Job<SpeakingGradingPayload>): Promise<void> {
  const { recordingId } = job.data;

  logger.info('Processing speaking grading', { recordingId });
  await job.updateProgress(5);

  // Load recording with all relations needed
  const recording = await prisma.speakingRecording.findUnique({
    where: { id: recordingId },
    include: {
      prompt: {
        select: { targetPhrase: true },
      },
      user: {
        select: { id: true },
      },
    },
  });

  if (!recording) {
    throw new Error(`SpeakingRecording not found: ${recordingId}`);
  }

  // Resolve targetLang via section -> class -> course
  const section = await prisma.classSection.findUnique({
    where: { id: recording.sectionId },
    select: {
      classId: true,
      class: {
        select: {
          course: {
            select: { targetLang: true },
          },
        },
      },
    },
  });

  if (!section) {
    throw new Error(`ClassSection not found for sectionId: ${recording.sectionId}`);
  }

  const targetLang = section.class.course.targetLang;
  const userId = recording.userId;

  // Mark as GRADING
  await prisma.speakingRecording.update({
    where: { id: recordingId },
    data: { status: 'GRADING' },
  });

  await job.updateProgress(15);

  let transcript: string;
  let wordTimings: Array<{ word: string; start: number; end: number }> | undefined;

  try {
    // Download audio from R2
    const audioRes = await fetch(recording.audioUrl);
    if (!audioRes.ok) {
      throw new Error(`Failed to download audio (${audioRes.status}): ${recording.audioUrl}`);
    }
    const audioArrayBuffer = await audioRes.arrayBuffer();
    const audioBuffer = Buffer.from(audioArrayBuffer);

    await job.updateProgress(35);

    // Resolve STT provider via BYOK or platform key
    const resolvedStt = await resolveSttProvider({
      userId,
      requestedProvider: 'openai',
    });

    const sttProvider = createSttProvider(resolvedStt.providerId, resolvedStt.apiKey, resolvedStt.model);
    const sttResult = await sttProvider.transcribe(audioBuffer, { language: targetLang });

    transcript = sttResult.text;
    wordTimings = sttResult.words;

    await job.updateProgress(60);
  } catch (err) {
    await prisma.speakingRecording.update({
      where: { id: recordingId },
      data: { status: 'FAILED' },
    });
    logger.error('Speaking grading failed during STT', {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  try {
    // Resolve AI key for scorer
    const aiKey = await getAiKey(userId);
    if (!aiKey) {
      throw new Error(`No AI key available for user ${userId}. Configure an AI key to enable pronunciation scoring.`);
    }

    const aiModel = getAiProviderMeta(aiKey.provider).defaultModel;

    const scorer = resolvePronunciationScorer({});
    const score = await scorer.score({
      targetPhrase: recording.prompt.targetPhrase,
      transcript,
      wordTimings,
      targetLang,
      aiProvider: aiKey.provider,
      aiModel,
      aiApiKey: aiKey.apiKey,
      userId,
    });

    await job.updateProgress(90);

    // Persist results
    await prisma.speakingRecording.update({
      where: { id: recordingId },
      data: {
        transcript: score.transcript,
        overallScore: score.overallScore,
        rubricScores: score.rubricScores as unknown as Prisma.InputJsonValue,
        phonemeScores: score.phonemeScores as unknown as Prisma.InputJsonValue,
        feedback: score.feedback,
        status: 'SCORED',
      },
    });

    await job.updateProgress(100);
    logger.info('Speaking grading completed', { recordingId, overallScore: score.overallScore });
  } catch (err) {
    await prisma.speakingRecording.update({
      where: { id: recordingId },
      data: { status: 'FAILED' },
    });
    logger.error('Speaking grading failed during scoring', {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
