import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveCapturedLearningAi } from '@/lib/learning-ai';
import { resolveCapturedSttProvider, getConfiguredSttProviderId } from '@/lib/providers/stt';
import { aiProviderRules } from '@/lib/providers/ai';
import {
  createSottoProviderTransport,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { resolvePronunciationScorer } from '@/lib/pronunciation/scorer';
import { logger } from '@/lib/logger';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { restoreStorageBackend } from '@/lib/r2';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isMediaCleanupFailure } from '@/lib/audio/media-process';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { speakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';

async function readSpeakingWork(database: Prisma.TransactionClient, recordingId: string) {
  const recording = await database.speakingRecording.findUnique({
    where: { id: recordingId },
    include: {
      prompt: { select: { targetPhrase: true } },
      user: { select: { id: true, preferredSttModel: true } },
    },
  });
  if (!recording) throw new Error(`SpeakingRecording not found: ${recordingId}`);
  if (recording.status === 'SCORED' || recording.status === 'FAILED')
    return { complete: true as const, status: recording.status };

  let targetLang: string;
  if (recording.sectionId) {
    const section = await database.classSection.findUnique({
      where: { id: recording.sectionId },
      select: { class: { select: { course: { select: { targetLang: true } } } } },
    });
    if (!section) throw new Error(`ClassSection not found for sectionId: ${recording.sectionId}`);
    targetLang = section.class.course.targetLang;
  } else if (recording.practiceSessionId) {
    const session = await database.practiceSession.findUnique({
      where: { id: recording.practiceSessionId },
      select: { course: { select: { targetLang: true } } },
    });
    if (!session)
      throw new Error(
        `PracticeSession not found for practiceSessionId: ${recording.practiceSessionId}`
      );
    targetLang = session.course.targetLang;
  } else if (recording.examSectionId) {
    const section = await database.examSection.findUnique({
      where: { id: recording.examSectionId },
      select: { exam: { select: { course: { select: { targetLang: true } } } } },
    });
    if (!section)
      throw new Error(`ExamSection not found for examSectionId: ${recording.examSectionId}`);
    targetLang = section.exam.course.targetLang;
  } else {
    throw new Error(
      `SpeakingRecording ${recordingId} has no parent section, practice session, or exam section`
    );
  }
  const [source, ownership] = await Promise.all([
    resolveStorageInput(database, {
      consumer: `recording:${recording.id}:audio`,
      reference: recording.audioUrl,
    }),
    captureSpeakingRecordingStorage(database, recording.id),
  ]);
  const inputs = {
    id: recording.id,
    createdAt: recording.createdAt.getTime(),
    sectionId: recording.sectionId,
    practiceSessionId: recording.practiceSessionId,
    examSectionId: recording.examSectionId,
    promptId: recording.promptId,
    userId: recording.userId,
    audioUrl: recording.audioUrl,
    targetPhrase: recording.prompt.targetPhrase,
    preferredSttModel: recording.user.preferredSttModel,
    targetLang,
    storage: source.input,
    ownership,
  };
  return { complete: false as const, inputs, backend: source.backend };
}

type SpeakingWork = Exclude<Awaited<ReturnType<typeof readSpeakingWork>>, { complete: true }>;
type DurableSpeakingWork = SpeakingWork & { operationId: string; fingerprint: string };

async function requireCurrentWork(database: Prisma.TransactionClient, captured: SpeakingWork) {
  const current = await readSpeakingWork(database, captured.inputs.id);
  if (
    current.complete ||
    !isDeepStrictEqual(current, {
      complete: false,
      inputs: captured.inputs,
      backend: captured.backend,
    })
  )
    throw new Error('Speaking grading inputs changed during execution');
}

export async function processSpeakingGrading(
  job: Job<unknown>,
  signal: AbortSignal = AbortSignal.timeout(600_000)
): Promise<void> {
  signal.throwIfAborted();
  const work = await sottoTransaction(
    prisma,
    async (database) => {
      const durable = await readSottoWorkerJob(database, job, {
        handler: 'speaking-grading',
        version: 1,
        payload: speakingGradingPayloadSchema,
      });
      if (durable.complete) return durable;
      const current = await readSpeakingWork(database, durable.payload.recordingId);
      if (current.complete) {
        await sottoJobOutbox(database).complete(durable.operationId, durable.fingerprint);
        return { complete: true as const };
      }
      if (
        current.inputs.createdAt !== durable.payload.recordingCreatedAt ||
        !isDeepStrictEqual(current.inputs.storage, durable.payload.storage) ||
        !isDeepStrictEqual(current.inputs.ownership, durable.payload.ownership)
      )
        throw new Error('Speaking grading payload does not match its recording');
      return { ...durable, ...current };
    },
    { signal }
  );
  if (work.complete) {
    await job.updateProgress(100);
    return;
  }
  await withSottoJobExecution({
    database: prisma,
    parentId: work.operationId,
    fingerprint: work.fingerprint,
    signal,
    isCleanupFailure: isMediaCleanupFailure,
    validate: async (database) => {
      const current = await readSpeakingWork(database, work.inputs.id);
      signal.throwIfAborted();
      if (current.complete) return false;
      if (
        !isDeepStrictEqual(current, {
          complete: false,
          inputs: work.inputs,
          backend: work.backend,
        })
      )
        throw new Error('Speaking grading inputs changed before execution');
      return true;
    },
    run: ({ directory, markCleanupUnconfirmed }) =>
      executeSpeakingGrading(job, work, signal, directory, markCleanupUnconfirmed),
  });
}

async function executeSpeakingGrading(
  job: Job<unknown>,
  work: DurableSpeakingWork,
  signal: AbortSignal,
  directory: string,
  markCleanupUnconfirmed: () => void
) {
  const { inputs } = work;
  logger.info('Processing speaking grading', { recordingId: inputs.id });
  await sottoTransaction(
    prisma,
    async (database) => {
      await requireCurrentWork(database, work);
      await database.speakingRecording.update({
        where: { id: inputs.id },
        data: { status: 'GRADING' },
      });
    },
    { signal }
  );
  await job.updateProgress(15);

  let dispatches = 0;
  let settlements = 0;
  const onDispatch = () => dispatches++;
  const onSettled = () => settlements++;
  const execution: SottoProviderExecution = {
    userId: inputs.userId,
    signal,
    authorize: async (database) => {
      await requireCurrentWork(database, work);
      return { userId: inputs.userId };
    },
  };

  try {
    const reader = await restoreStorageBackend(work.backend.descriptor);
    const audioPath = join(directory, 'recording');
    await reader.downloadToFile(inputs.storage.key, audioPath, signal);
    const audioBuffer = await readFile(audioPath, { signal });
    await job.updateProgress(35);

    const resolvedStt = await resolveCapturedSttProvider({
      userId: inputs.userId,
      execution,
      requestedProvider: getConfiguredSttProviderId(),
      requestedModel: inputs.preferredSttModel ?? undefined,
      language: inputs.targetLang,
    });
    const sttResult = await resolvedStt.provider.transcribe(audioBuffer, {
      language: inputs.targetLang,
      signal,
      onDispatch,
      onSettled,
    });
    await job.updateProgress(60);

    const ai = await resolveCapturedLearningAi(inputs.userId, execution);
    const rules = aiProviderRules(ai.provider);
    const aiTransport = rules.length
      ? await createSottoProviderTransport(ai.execution, rules)
      : undefined;
    const score = await resolvePronunciationScorer({}).score({
      targetPhrase: inputs.targetPhrase,
      transcript: sttResult.text,
      wordTimings: sttResult.words,
      targetLang: inputs.targetLang,
      aiProvider: ai.provider,
      aiModel: ai.model,
      aiApiKey: ai.apiKey,
      userId: inputs.userId,
      signal,
      fetch: aiTransport
        ? (request, init) =>
            aiTransport.authenticatedFetch(request, init, {
              onDispatch,
              onConsumed: ({ status }) => {
                if (status < 500) onSettled();
              },
            })
        : undefined,
    });
    if (dispatches !== settlements) {
      markCleanupUnconfirmed();
      throw new Error('Speaking provider request has no terminal response proof');
    }
    await job.updateProgress(90);

    await sottoTransaction(
      prisma,
      async (database) => {
        await requireCurrentWork(database, work);
        await validateStorageInputs(database, [inputs.storage]);
        await database.speakingRecording.update({
          where: { id: inputs.id },
          data: {
            transcript: score.transcript,
            overallScore: score.overallScore,
            rubricScores: score.rubricScores as unknown as Prisma.InputJsonValue,
            phonemeScores: score.phonemeScores as unknown as Prisma.InputJsonValue,
            feedback: score.feedback,
            status: 'SCORED',
          },
        });
        if (!(await sottoJobOutbox(database).complete(work.operationId, work.fingerprint)))
          throw new Error('Speaking grading work was already completed');
      },
      { signal }
    );
    await job.updateProgress(100);
    logger.info('Speaking grading completed', {
      recordingId: inputs.id,
      overallScore: score.overallScore,
    });
  } catch (error) {
    if (dispatches !== settlements) {
      markCleanupUnconfirmed();
    }
    logger.error('Speaking grading failed', {
      recordingId: inputs.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
