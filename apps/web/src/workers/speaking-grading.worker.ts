import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
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
import {
  sottoJobExecutions,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isMediaCleanupFailure } from '@/lib/audio/media-process';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  classSpeakingGradingPayloadSchema,
  speakingGradingPayloadSchema,
} from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
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
import {
  InitialA1PracticeBlocked,
  readInitialA1PracticeAuthorization,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';

async function readSpeakingWork(database: Prisma.TransactionClient, recordingId: string) {
  const recording = await database.speakingRecording.findUnique({
    where: { id: recordingId },
    include: {
      prompt: { select: { targetPhrase: true, translation: true, learningObjectives: true } },
      user: { select: { id: true, preferredSttModel: true } },
    },
  });
  if (!recording) throw new Error(`SpeakingRecording not found: ${recordingId}`);
  if (recording.status === 'UNRESOLVED') throw new Error('Speaking grading requires recovery');
  if (recording.status === 'SCORED' || recording.status === 'FAILED')
    return { complete: true as const, status: recording.status };

  let targetLang: string;
  let classId: string | null = null;
  let criterionCourseId: string | undefined;
  let criterionLevel: string | undefined;
  let privateSelection: unknown;
  if (recording.sectionId) {
    const section = await database.classSection.findUnique({
      where: { id: recording.sectionId },
      select: {
        classId: true,
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
    classId = section.classId;
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
    gradingOperationId: recording.gradingOperationId,
    attempt: recording.attempt,
    sectionId: recording.sectionId,
    classId,
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
type ClassAuthorization = NonNullable<
  import('zod').infer<typeof speakingGradingPayloadSchema>['classAuthorization']
>;
type DurableSpeakingWork = SpeakingWork & {
  operationId: string;
  fingerprint: string;
  classAuthorization?: ClassAuthorization;
  grant?: import('zod').infer<typeof classSpeakingGradingPayloadSchema>['grant'];
  classScope?: { subjectId: string; generation: number };
};

class SpeakingAuthorizationChanged extends Error {
  constructor() {
    super('Speaking grading prerequisite authorization changed');
  }
}

function speakingGrant(database: Prisma.TransactionClient, work: DurableSpeakingWork) {
  if (!work.grant || work.grant.id !== work.operationId || !work.inputs.classId)
    throw new Error('Speaking grading grant does not match its class');
  const parent = work.inputs.ownership.associations.parents.find(
    (candidate) => candidate.kind === 'class' && candidate.parentId === work.inputs.classId
  );
  if (!parent) throw new Error('Speaking grading course ownership changed');
  return learningPreparationGrant(
    database,
    {
      id: work.operationId,
      userId: work.inputs.userId,
      courseId: parent.courseId,
    },
    'speaking'
  );
}

async function requireClassScope(database: Prisma.TransactionClient, work: DurableSpeakingWork) {
  if (!work.grant) return;
  if (!work.classScope || !work.inputs.classId)
    throw new Error('Speaking grading class scope is missing');
  const parent = work.inputs.ownership.associations.parents.find(
    (candidate) => candidate.kind === 'class' && candidate.parentId === work.inputs.classId
  );
  if (!parent) throw new Error('Speaking grading class ownership changed');
  const ownership = await capturePrerequisiteOwnership(
    database,
    work.inputs.classId,
    parent.courseId,
    work.inputs.userId
  );
  if (!ownership.scopes.some((scope) => isDeepStrictEqual(scope, work.classScope)))
    throw new Error('Speaking grading class scope changed');
}

async function requireClassAuthorization(
  database: Prisma.TransactionClient,
  work: SpeakingWork,
  captured?: ClassAuthorization
) {
  if (!work.inputs.sectionId) {
    if (captured)
      throw new Error('Speaking grading class authorization does not match its recording');
    return;
  }
  const classId = work.inputs.classId;
  if (!classId || (captured && classId !== captured.classId))
    throw new Error('Speaking grading class authorization does not match its recording');
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
  const current = await readInitialA1PracticeAuthorization(database, classId, work.inputs.userId);
  if (!isDeepStrictEqual(current, captured?.authorization ?? null))
    throw new SpeakingAuthorizationChanged();
}

async function requireCurrentWork(
  database: Prisma.TransactionClient,
  captured: DurableSpeakingWork
) {
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
  await requireClassAuthorization(database, current, captured.classAuthorization);
  await requireClassScope(database, captured);
  if (
    captured.grant &&
    (await database.speakingRecording.findFirst({
      where: {
        id: { not: captured.inputs.id },
        promptId: captured.inputs.promptId,
        userId: captured.inputs.userId,
        sectionId: captured.inputs.sectionId,
        attempt: captured.inputs.attempt,
        status: 'UNRESOLVED',
        gradingAcknowledgedAt: null,
      },
      select: { id: true },
    }))
  )
    throw new Error('An earlier speaking recording requires recovery');
}

/** Retire only a changed class job that provably never admitted provider work. */
async function failUnstartedChangedClassWork(
  database: Prisma.TransactionClient,
  work: DurableSpeakingWork
): Promise<boolean> {
  if (!work.grant) return false;
  const current = await readSpeakingWork(database, work.inputs.id);
  if (
    current.complete ||
    current.inputs.createdAt !== work.inputs.createdAt ||
    current.inputs.userId !== work.inputs.userId ||
    current.inputs.sectionId !== work.inputs.sectionId ||
    !isDeepStrictEqual(current.inputs.storage, work.inputs.storage) ||
    !isDeepStrictEqual(current.inputs.ownership, work.inputs.ownership)
  )
    return false;
  await requireClassScope(database, work);
  try {
    await requireClassAuthorization(database, current, work.classAuthorization);
    return false;
  } catch (error) {
    if (!(
      error instanceof SpeakingAuthorizationChanged || error instanceof InitialA1PracticeBlocked
    ))
      throw error;
  }
  const authority = speakingGrant(database, work);
  const state = await authority.read(work.grant);
  if (state.status !== 'active' || state.attempts.length !== 0) return false;
  await sottoJobExecutions(database).requireParentDrained(work.operationId, work.fingerprint);
  await authority.revoke(work.grant);
  await database.speakingRecording.update({
    where: { id: current.inputs.id },
    data: { status: 'FAILED', feedback: 'Teaching changed. Review it before recording again.' },
  });
  if (!(await sottoJobOutbox(database).complete(work.operationId, work.fingerprint)))
    throw new Error('Speaking grading work was already completed');
  return true;
}

/** Preserve an uncertain paid attempt and permanently stop this job's redispatch. */
async function markSpeakingUnresolved(
  database: Prisma.TransactionClient,
  work: DurableSpeakingWork
): Promise<boolean> {
  if (!work.grant || !work.inputs.classId) return false;
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${work.inputs.classId} FOR UPDATE`;
  const recording = await database.speakingRecording.findUnique({ where: { id: work.inputs.id } });
  if (
    !recording ||
    recording.gradingOperationId !== work.operationId ||
    recording.userId !== work.inputs.userId ||
    recording.sectionId !== work.inputs.sectionId ||
    recording.createdAt.getTime() !== work.inputs.createdAt ||
    recording.status === 'SCORED' ||
    recording.status === 'FAILED'
  )
    return false;
  const authority = speakingGrant(database, work);
  const state = await authority.read(work.grant);
  if (state.attempts.length === 0 || state.status === 'completed') return false;
  await authority.revoke(work.grant);
  await database.speakingRecording.update({
    where: { id: recording.id },
    data: {
      status: 'UNRESOLVED',
      feedback: 'The grading outcome is unknown. Your recording is saved.',
    },
  });
  if (!(await sottoJobOutbox(database).complete(work.operationId, work.fingerprint)))
    throw new Error('Speaking grading work was already completed');
  return true;
}

export async function processSpeakingGrading(
  job: Job<unknown>,
  signal: AbortSignal = AbortSignal.timeout(600_000)
): Promise<void> {
  signal.throwIfAborted();
  if (job.name === 'speaking-grading.v3') {
    const { processAssessmentSpeaking } = await import('./classes/assessment-speaking.worker');
    return processAssessmentSpeaking(job, signal);
  }
  const version = job.name === 'speaking-grading.v2' ? 2 : 1;
  const work = await sottoTransaction(
    prisma,
    async (database) => {
      const durable = await readSottoWorkerJob(database, job, {
        handler: 'speaking-grading',
        version,
        payload: version === 2 ? classSpeakingGradingPayloadSchema : speakingGradingPayloadSchema,
      });
      if (durable.complete) return durable;
      const current = await readSpeakingWork(database, durable.payload.recordingId);
      if (current.complete) {
        if (version === 2) {
          const payload = classSpeakingGradingPayloadSchema.parse(durable.payload);
          const parent = payload.ownership.associations.parents.find(
            (candidate) =>
              candidate.kind === 'class' &&
              candidate.parentId === payload.classAuthorization.classId
          );
          if (!parent || payload.grant.id !== durable.operationId)
            throw new Error('Terminal speaking grading ownership changed');
          await sottoJobExecutions(database).requireParentDrained(
            durable.operationId,
            durable.fingerprint
          );
          const authority = learningPreparationGrant(
            database,
            {
              id: durable.operationId,
              userId: payload.ownership.associations.userId,
              courseId: parent.courseId,
            },
            'speaking'
          );
          const grant = await authority.read(payload.grant);
          if (
            current.status === 'FAILED' &&
            grant.status === 'active' &&
            grant.attempts.length === 0
          )
            await authority.revoke(payload.grant);
          else if (
            (current.status === 'SCORED' && grant.status !== 'completed') ||
            (current.status === 'FAILED' &&
              !(grant.status === 'revoked' && grant.attempts.length === 0))
          )
            throw new Error('Terminal speaking grading provider work requires recovery');
        }
        await sottoJobOutbox(database).complete(durable.operationId, durable.fingerprint);
        return { complete: true as const };
      }
      if (
        current.inputs.createdAt !== durable.payload.recordingCreatedAt ||
        !isDeepStrictEqual(current.inputs.storage, durable.payload.storage) ||
        !isDeepStrictEqual(current.inputs.ownership, durable.payload.ownership)
      )
        throw new Error('Speaking grading payload does not match its recording');
      if (version === 1 && current.inputs.gradingOperationId != null)
        throw new Error('Legacy speaking grading no longer owns this recording');
      if (version === 1 && current.inputs.sectionId) {
        const legacy = await database.speakingRecording.findUniqueOrThrow({
          where: { id: current.inputs.id },
          select: { status: true },
        });
        if (legacy.status === 'GRADING' || (job.attemptsMade ?? 0) > 0) {
          if (!current.inputs.classId) throw new Error('Legacy speaking class is missing');
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${current.inputs.classId} FOR UPDATE`;
          await sottoJobExecutions(database).requireParentDrained(
            durable.operationId,
            durable.fingerprint
          );
          await database.speakingRecording.update({
            where: { id: current.inputs.id },
            data: {
              status: 'UNRESOLVED',
              gradingOperationId: durable.operationId,
              feedback: 'The grading outcome is unknown. Your recording is saved.',
            },
          });
          if (!(await sottoJobOutbox(database).complete(durable.operationId, durable.fingerprint)))
            throw new Error('Legacy speaking work was already completed');
          return { complete: true as const };
        }
      }
      const grant =
        version === 2 ? classSpeakingGradingPayloadSchema.parse(durable.payload).grant : undefined;
      if (grant && current.inputs.gradingOperationId !== durable.operationId)
        throw new Error('Speaking grading operation no longer owns this recording');
      const classScope = grant
        ? durable.scopes.find((scope) => scope.subjectId === `class:${current.inputs.classId}`)
        : undefined;
      if (grant && !classScope) throw new Error('Speaking grading class scope is missing');
      const captured = {
        ...durable,
        ...current,
        grant,
        classScope,
        classAuthorization: durable.payload.classAuthorization,
      };
      if (grant) {
        const state = await speakingGrant(database, captured).read(grant);
        if (state.attempts.length > 0) {
          const blocked = await sottoJobExecutions(database).blockingStatus(
            durable.operationId,
            durable.fingerprint
          );
          if (blocked === 'active') throw new Error('Speaking grading execution is still active');
          if (await markSpeakingUnresolved(database, captured)) return { complete: true as const };
        }
      }
      try {
        await requireClassAuthorization(database, current, durable.payload.classAuthorization);
        await requireClassScope(database, captured);
      } catch (error) {
        if (!(
          error instanceof SpeakingAuthorizationChanged || error instanceof InitialA1PracticeBlocked
        ))
          throw error;
        if (!grant && version === 1 && current.inputs.sectionId) {
          await sottoJobExecutions(database).requireParentDrained(
            durable.operationId,
            durable.fingerprint
          );
          await database.speakingRecording.update({
            where: { id: current.inputs.id },
            data: {
              status: 'UNRESOLVED',
              gradingOperationId: durable.operationId,
              feedback: 'The grading outcome is unknown. Your recording is saved.',
            },
          });
          if (!(await sottoJobOutbox(database).complete(durable.operationId, durable.fingerprint)))
            throw new Error('Speaking grading work was already completed');
          return { complete: true as const };
        }
        if (!grant) throw error;
        if (!(await failUnstartedChangedClassWork(database, captured))) throw error;
        return { complete: true as const };
      }
      return { ...durable, ...current, grant, classScope };
    },
    { signal }
  );
  if (work.complete) {
    await job.updateProgress(100);
    return;
  }
  try {
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
        await requireClassAuthorization(database, current, work.payload.classAuthorization);
        await requireClassScope(database, work);
        if (work.grant) {
          const grant = await speakingGrant(database, work).read(work.grant);
          if (grant.status !== 'active' || grant.attempts.length !== 0)
            throw new Error('Speaking grading has previous provider attempts requiring recovery');
        }
        return true;
      },
      run: ({ directory, markCleanupUnconfirmed }) =>
        executeSpeakingGrading(
          job,
          { ...work, classAuthorization: work.payload.classAuthorization },
          signal,
          directory,
          markCleanupUnconfirmed
        ),
    });
  } catch (error) {
    const retired = await sottoTransaction(prisma, async (database) => {
      const captured = {
        ...work,
        classAuthorization: work.payload.classAuthorization,
      };
      return (
        (await failUnstartedChangedClassWork(database, captured)) ||
        (await markSpeakingUnresolved(database, captured))
      );
    });
    if (!retired) throw error;
    await job.updateProgress(100);
  }
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
    ...(work.grant
      ? {
          providerRequest: learningPreparationProviderRequest(
            {
              selection: { recordingId: inputs.id, operationId: work.operationId },
              admit: async (database, attempt) => {
                await requireCurrentWork(database, work);
                return speakingGrant(database, work).admit(work.grant!, attempt);
              },
              settle: async (database, attempt, outcome) =>
                speakingGrant(database, work).settle(work.grant!, attempt, outcome),
            },
            signal,
            markCleanupUnconfirmed
          ),
        }
      : {}),
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
    const cliAttempt =
      !aiTransport && work.grant
        ? {
            id: randomUUID(),
            fingerprint: createHash('sha256')
              .update(
                JSON.stringify({
                  operationId: work.operationId,
                  recordingId: inputs.id,
                  transcript: sttResult.text,
                  targetPhrase: inputs.targetPhrase,
                  learningObjectives: inputs.learningObjectives,
                })
              )
              .digest('hex'),
          }
        : undefined;
    if (cliAttempt && work.grant) {
      await sottoTransaction(
        prisma,
        async (database) => {
          await requireCurrentWork(database, work);
          const admission = await speakingGrant(database, work).admit(work.grant!, cliAttempt);
          if (!admission.dispatch)
            throw new Error('Speaking grading provider attempt already exists');
        },
        { signal }
      );
    }
    if (!aiTransport) onDispatch();
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
    if (!aiTransport) onSettled();
    if (cliAttempt && work.grant)
      await sottoTransaction(prisma, (database) =>
        speakingGrant(database, work).settle(work.grant!, cliAttempt, 'succeeded')
      );
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
        if (work.grant) await speakingGrant(database, work).complete(work.grant);
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
    if (dispatches > 0) {
      markCleanupUnconfirmed();
    }
    logger.error('Speaking grading failed', {
      recordingId: inputs.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
