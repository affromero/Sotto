import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { capturedLearningAiOptions, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { resolveCapturedSttProvider, getConfiguredSttProviderId } from '@/lib/providers/stt';
import { aiProviderRules } from '@/lib/providers/ai';
import {
  createSottoProviderTransport,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { resolvePronunciationScorer } from '@/lib/pronunciation/scorer';
import { logger } from '@/lib/logger';
import { getServerInfra } from '@/lib/server-config';
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
import { readSkillRequirements } from '@/lib/learning/skill-requirements';
import { sttSelectionSchema } from '@/lib/learning/speech-selection';
import { speakingTaskMode } from '@/lib/learning-map/evidence/communicative-speaking';
import {
  objectiveEvidenceHash,
  reviewedObjectiveAssessmentSchema,
} from '@/lib/learning-map/evidence/protocol';
import { gradeProductiveObjective } from '@/lib/learning-map/evidence/productive';
import {
  assertPrivateSpeakingSession,
  isPrivateSpeakingAssessment,
} from '@/lib/learning-map/evidence/private-speaking/protocol';
import { gradePrivateSourceSpeaking } from '@/lib/learning-map/evidence/private-speaking/grade';

async function readSpeakingWork(database: Prisma.TransactionClient, recordingId: string) {
  const recording = await database.speakingRecording.findUnique({
    where: { id: recordingId },
    include: {
      prompt: { select: { targetPhrase: true, translation: true, learningObjectives: true } },
      user: { select: { id: true, preferredSttModel: true } },
    },
  });
  if (!recording) throw new Error(`SpeakingRecording not found: ${recordingId}`);
  if (recording.status === 'SCORED' || recording.status === 'FAILED')
    return { complete: true as const, status: recording.status };

  let targetLang: string;
  let criterionCourseId: string | undefined;
  let criterionLevel: string | undefined;
  let privateSelection: unknown;
  if (recording.sectionId) {
    const section = await database.classSection.findUnique({
      where: { id: recording.sectionId },
      select: {
        attempt: true,
        class: {
          select: {
            courseId: true,
            skillRequirements: true,
            course: { select: { targetLang: true } },
          },
        },
      },
    });
    if (!section) throw new Error(`ClassSection not found for sectionId: ${recording.sectionId}`);
    if (section.attempt != null && section.attempt !== recording.attempt)
      throw new Error('The speaking exercise attempt changed');
    targetLang =
      readSkillRequirements(section.class.skillRequirements)?.targetLang ??
      section.class.course.targetLang;
    criterionCourseId = section.class.courseId;
    criterionLevel = readSkillRequirements(section.class.skillRequirements)?.level;
  } else if (recording.practiceSessionId) {
    const session = await database.practiceSession.findUnique({
      where: { id: recording.practiceSessionId },
      select: {
        courseId: true,
        skillRequirements: true,
        learningSelection: true,
        course: { select: { targetLang: true } },
      },
    });
    if (!session)
      throw new Error(
        `PracticeSession not found for practiceSessionId: ${recording.practiceSessionId}`
      );
    targetLang =
      readSkillRequirements(session.skillRequirements)?.targetLang ?? session.course.targetLang;
    criterionCourseId = session.courseId;
    criterionLevel = readSkillRequirements(session.skillRequirements)?.level;
    privateSelection = session.learningSelection;
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
  if (speakingTaskMode(recording.prompt.learningObjectives) === 'COMMUNICATIVE') {
    if (isPrivateSpeakingAssessment(recording.prompt.learningObjectives)) {
      if (!recording.practiceSessionId || !criterionCourseId)
        throw new Error('Private speaking feedback requires its owned practice session.');
      assertPrivateSpeakingSession({
        assessment: recording.prompt.learningObjectives,
        userId: recording.userId,
        courseId: criterionCourseId,
        targetLang,
        level: criterionLevel,
        selection: privateSelection,
        task: recording.prompt.targetPhrase,
        guidance: recording.prompt.translation ?? null,
      });
    } else {
      const assessment = reviewedObjectiveAssessmentSchema.parse(
        recording.prompt.learningObjectives
      );
      if (
        assessment.scope.userId !== recording.userId ||
        assessment.scope.courseId !== criterionCourseId ||
        assessment.scope.targetLang !== targetLang ||
        assessment.scope.level !== criterionLevel ||
        objectiveEvidenceHash(assessment.task) !==
          objectiveEvidenceHash({
            kind: 'COMMUNICATIVE_SPEAKING',
            task: recording.prompt.targetPhrase,
            guidance: recording.prompt.translation,
            suppliedSupport: [],
          })
      )
        throw new Error('The communicative speaking criterion changed its actual task or session.');
    }
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
    translation: recording.prompt.translation ?? null,
    learningObjectives: recording.prompt.learningObjectives ?? null,
    preferredSttModel: recording.sttSelection ? null : recording.user.preferredSttModel,
    sttProvider: recording.sttProvider,
    sttSelection: recording.sttSelection ? sttSelectionSchema.parse(recording.sttSelection) : null,
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
    isolatedWorkspace: { directory, markCleanupUnconfirmed },
    onCleanupError: markCleanupUnconfirmed,
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

    await getServerInfra();
    const resolvedStt = await resolveCapturedSttProvider({
      userId: inputs.userId,
      execution,
      requestedProvider:
        (inputs.sttProvider as Parameters<
          typeof resolveCapturedSttProvider
        >[0]['requestedProvider']) ?? getConfiguredSttProviderId(),
      requestedModel: inputs.sttSelection?.model ?? inputs.preferredSttModel ?? undefined,
      language: inputs.targetLang,
    });
    if (inputs.sttSelection && !isDeepStrictEqual(inputs.sttSelection, resolvedStt.selection))
      throw new Error(
        'The selected speech model, endpoint or credential changed. Record a new attempt with the current provider settings.'
      );
    const sttResult = await resolvedStt.provider.transcribe(audioBuffer, {
      language: inputs.targetLang,
      signal,
      onDispatch,
      onSettled,
    });
    await job.updateProgress(60);

    const ai = await resolveCapturedLearningAi(inputs.userId, execution);
    const rules = aiProviderRules(ai.provider, ai.endpoint);
    const aiTransport = rules.length
      ? await createSottoProviderTransport(ai.execution, rules)
      : undefined;
    const observedFetch: typeof fetch | undefined = aiTransport
      ? (request, init) =>
          aiTransport.authenticatedFetch(request, init, {
            onDispatch,
            onConsumed: ({ status }) => {
              if (status < 500) onSettled();
            },
          })
      : undefined;
    let objectiveEvidence:
      import('@/lib/learning-map/evidence/protocol').ProductiveCriterionFinding | undefined;
    const score =
      speakingTaskMode(inputs.learningObjectives) === 'COMMUNICATIVE'
        ? await (async () => {
            const cli = !observedFetch;
            if (cli) onDispatch();
            const privateAssessment = isPrivateSpeakingAssessment(inputs.learningObjectives);
            const grading = {
              userId: inputs.userId,
              execution,
              ai,
              text: sttResult.text,
              fetch: observedFetch,
            };
            const qualified = privateAssessment
              ? await gradePrivateSourceSpeaking({
                  ...grading,
                  assessment: inputs.learningObjectives,
                })
              : await gradeProductiveObjective({
                  ...grading,
                  assessment: reviewedObjectiveAssessmentSchema.parse(inputs.learningObjectives),
                });
            if (cli) onSettled();
            if (!privateAssessment) objectiveEvidence = qualified.finding;
            return {
              transcript: sttResult.text,
              overallScore: qualified.finding.quality ?? 0,
              rubricScores: { communicative: qualified.finding.quality ?? 0 },
              phonemeScores: [],
              feedback: qualified.feedback,
            };
          })()
        : await resolvePronunciationScorer({}).score({
            targetPhrase: inputs.targetPhrase,
            transcript: sttResult.text,
            wordTimings: sttResult.words,
            targetLang: inputs.targetLang,
            aiOptions: await capturedLearningAiOptions(ai),
            aiProvider: ai.provider,
            aiModel: ai.model,
            aiApiKey: ai.apiKey,
            aiEndpoint: ai.endpoint,
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
            objectiveEvidence: objectiveEvidence as unknown as Prisma.InputJsonValue | undefined,
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
