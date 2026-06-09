import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { SpeakingGradingPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveLearningAi } from '@/lib/learning-ai';
import { resolveSttProvider, createSttProvider, getConfiguredSttProviderId } from '@/lib/providers/stt';
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

  // Resolve targetLang via the recording's parent: a class section
  // (section -> class -> course) or a practice session (practiceSession -> course).
  let targetLang: string;
  if (recording.sectionId) {
    const section = await prisma.classSection.findUnique({
      where: { id: recording.sectionId },
      select: { class: { select: { course: { select: { targetLang: true } } } } },
    });
    if (!section) {
      throw new Error(`ClassSection not found for sectionId: ${recording.sectionId}`);
    }
    targetLang = section.class.course.targetLang;
  } else if (recording.practiceSessionId) {
    const ps = await prisma.practiceSession.findUnique({
      where: { id: recording.practiceSessionId },
      select: { course: { select: { targetLang: true } } },
    });
    if (!ps) {
      throw new Error(`PracticeSession not found for practiceSessionId: ${recording.practiceSessionId}`);
    }
    targetLang = ps.course.targetLang;
  } else {
    throw new Error(`SpeakingRecording ${recordingId} has no parent section or practice session`);
  }
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

    // Resolve STT provider via BYOK or platform key. Honor the instance's
    // configured provider (STT_PROVIDER) so a self-hoster running STT_PROVIDER=local
    // grades pronunciation on a local Whisper server with no cloud key.
    const resolvedStt = await resolveSttProvider({
      userId,
      requestedProvider: getConfiguredSttProviderId(),
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
    // Resolve the learning AI provider (BYOK or local agent) for the scorer
    const ai = await resolveLearningAi(userId);

    const scorer = resolvePronunciationScorer({});
    const score = await scorer.score({
      targetPhrase: recording.prompt.targetPhrase,
      transcript,
      wordTimings,
      targetLang,
      aiProvider: ai.provider,
      aiModel: ai.model,
      aiApiKey: ai.apiKey,
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
