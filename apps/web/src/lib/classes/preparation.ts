import { type CefrLevel } from '@sotto/shared';
import { resolveSkillRequirementsInTransaction } from '../learning/skill-requirements';
import { readSkillRequirements } from '../learning/skill-requirements';
import { selectClassRepairSkills } from '../learning/classes/class-repair';
import { claimClassRegenerationInTransaction } from '../learning/classes/class-generation-state';
import { readPristine } from './regeneration/pristine';
import { learningSpeechFingerprint } from '../learning/speech-configuration';
import { createHash, randomUUID } from 'node:crypto';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { z } from 'zod';
import { delegationGrantBinding, type DelegationGrant } from 'thesidedoor-core/runtime/delegation';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { resolveCapturedLearningAi, captureLearningModerationCredential } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from './preparation-selection';
import { validateSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { classPreparationGrant, preparationGrantSpec } from './preparation-grant';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { settlePreparationAudio } from './preparation-audio-settlement';
import {
  readLearningFailure,
  writeLearningFailure,
  learningFailureReason,
  type LearningFailure,
} from './quality/teaching-failure-store';
import {
  admitPreparation,
  cancelPreparation,
  preparationStore,
  PreparationConflictError,
  type ClassPreparation,
} from './preparation-state';

function targetFingerprint(target: {
  id: string;
  courseId: string;
  lessonId: string;
  createdAt: Date;
  sourceUrl: string | null;
  sourceTitle: string | null;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        target.id,
        target.courseId,
        target.lessonId,
        target.createdAt.getTime(),
        target.sourceUrl,
        target.sourceTitle,
      ])
    )
    .digest('hex');
}

export const CLASS_PREPARATION_QUEUE = 'class-preparation';
export const classPreparationPayload = z
  .object({
    courseId: z.string().min(1),
    operationId: z.uuid(),
    sourceUrl: z.string().url().max(4000).optional(),
    topic: z.string().max(2000).optional(),
  })
  .strict();

export function classPreparationBackend(database: Prisma.TransactionClient, courseId: string) {
  return sqlStateBackend(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    `${SIDEDOOR_STATE_ID}:class-preparation:${createHash('sha256').update(courseId).digest('hex')}`
  );
}

export const classPreparationStore = (database: Prisma.TransactionClient, courseId: string) =>
  preparationStore(classPreparationBackend(database, courseId));

export async function validateClassPreparation(
  database: Prisma.TransactionClient,
  courseId: string,
  operationId: string,
  allowTerminal = false
) {
  const operation = await classPreparationStore(database, courseId).read();
  if (!operation || operation.id !== operationId)
    throw new PreparationConflictError('The preparation task was replaced.');
  const ownership = await captureCourseStorage(database, courseId);
  if (
    ownership.userId !== operation.userId ||
    ownership.instanceId !== operation.instanceId ||
    !ownership.scopes.some(
      (scope) =>
        scope.subjectId === `course:${courseId}` && scope.generation === operation.courseCreatedAt
    ) ||
    !ownership.scopes.some(
      (scope) =>
        scope.subjectId === `profile:${operation.userId}` &&
        scope.generation === operation.userCreatedAt
    )
  )
    throw new PreparationConflictError('The preparation owner changed.');
  if (!allowTerminal && (operation.status !== 'RUNNING' || Date.now() >= operation.expiresAt))
    throw new PreparationConflictError('The preparation task is no longer authorized.');
  if (!allowTerminal) {
    await classPreparationGrant(database, operation).validate(operation.grant);
    if (operation.intent) {
      const target = await database.courseClass.findFirst({
        where: {
          id: operation.intent.classId,
          courseId,
          attempt: operation.intent.attempt,
          status: 'GENERATING',
        },
      });
      if (
        !target ||
        targetFingerprint(target) !== operation.intent.classFingerprint ||
        JSON.stringify(readSkillRequirements(target.skillRequirements)) !==
          JSON.stringify(operation.requirements)
      )
        throw new PreparationConflictError('The admitted class repair attempt changed.');
    }
    if (operation.requirements) {
      const course = await database.course.findUniqueOrThrow({
        where: { id: courseId },
        select: {
          nativeLang: true,
          targetLang: true,
          currentLevel: true,
        },
      });
      if (
        !operation.intent &&
        (course.nativeLang !== operation.requirements.nativeLang ||
          course.targetLang !== operation.requirements.targetLang ||
          course.currentLevel !== (operation.courseLevel ?? operation.requirements.level))
      )
        throw new PreparationConflictError('The admitted class language or level changed.');
      if (
        (await learningSpeechFingerprint(
          database,
          async () => ({ userId: operation.userId }),
          operation.requirements
        )) !== operation.speechFingerprint
      )
        throw new PreparationConflictError(
          'The selected speech model, endpoint or credential changed.'
        );
    }
  }
  return operation;
}

/** The operation and outbox record commit before callers receive an accepted response. */
export async function requestClassPreparation(
  courseId: string,
  execution: SottoProviderExecution,
  input: {
    sourceUrl?: string;
    topic?: string;
    intent?: {
      kind: 'REGENERATE' | 'REPAIR';
      classId: string;
      expectedAttempt: number;
      pristineSnapshot?: string;
    };
    availableAt?: number;
    maxProviderRequests?: number;
    deferAudio?: boolean;
    timeZone?: string;
  } = {}
): Promise<ClassPreparation> {
  const now = Date.now();
  const availableAt = input.availableAt ?? now;
  const budgeted =
    input.maxProviderRequests !== undefined || input.deferAudio === true || availableAt > now;
  const maxProviderRequests = budgeted
    ? z
        .number()
        .int()
        .min(1)
        .max(256)
        .parse(input.maxProviderRequests ?? 128)
    : null;
  const timeZone = input.timeZone ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(now);
  } catch {
    throw new PreparationConflictError('Choose a valid time zone.');
  }
  if (availableAt > now && input.deferAudio !== true)
    throw new PreparationConflictError(
      'Scheduled preparation requires audio review before generation.'
    );
  if (
    !Number.isSafeInteger(availableAt) ||
    availableAt < now - 60_000 ||
    availableAt > now + 7 * 86_400_000
  )
    throw new PreparationConflictError('Choose a preparation time within the next seven days.');
  const id = randomUUID();
  const revision = randomUUID();
  const payload = classPreparationPayload.parse({
    courseId,
    operationId: id,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
  });
  const inputFingerprint = createHash('sha256')
    .update(JSON.stringify({ sourceUrl: payload.sourceUrl ?? null, topic: payload.topic ?? null }))
    .digest('hex');
  const ai = await resolveCapturedLearningAi(execution.userId, execution);
  const moderationCredential = await captureLearningModerationCredential(execution);
  if (budgeted && (ai.provider === 'codex' || (ai.provider === 'claude-code' && !ai.isolatedImage)))
    throw new PreparationConflictError(
      'Budgeted background preparation requires an API or local HTTP model. Select one in Settings.'
    );
  const selection = {
    provider: ai.provider,
    model: ai.model,
    ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
    ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
    credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
    moderationCredentialFingerprint: learningCredentialFingerprint(moderationCredential),
  };
  return sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new PreparationConflictError('The learner changed.');
      if (ai.execution.credential)
        await validateSottoExecutionCredential(
          database,
          execution.authorize,
          ai.execution.credential,
          execution.signal
        );
      if (moderationCredential)
        await validateSottoExecutionCredential(
          database,
          execution.authorize,
          moderationCredential,
          execution.signal
        );
      const ownership = await captureCourseStorage(database, courseId);
      if (ownership.userId !== actor.userId)
        throw new PreparationConflictError('Course not found.');
      const courseScope = ownership.scopes.find(
        (scope) => scope.subjectId === `course:${courseId}`
      )!;
      const userScope = ownership.scopes.find(
        (scope) => scope.subjectId === `profile:${actor.userId}`
      )!;
      const grantSpec: DelegationGrant = {
        id,
        revision,
        instanceId: ownership.instanceId,
        subject: { id: `profile:${actor.userId}`, generation: userScope.generation },
        resource: { id: `course:${courseId}`, generation: courseScope.generation },
        operationId: id,
        action: 'class-parent-provider-request',
        expiresAt: availableAt + 86_400_000,
        maxRequests: maxProviderRequests ?? 1000,
      };
      const course = await database.course.findUniqueOrThrow({
        where: { id: courseId },
        select: {
          nativeLang: true,
          targetLang: true,
          currentLevel: true,
        },
      });
      const target = input.intent
        ? await database.courseClass.findFirst({
            where: { id: input.intent.classId, courseId, course: { userId: actor.userId } },
            include: {
              lesson: true,
              course: true,
              sections: {
                include: {
                  questions: true,
                  prompts: true,
                  writingPrompts: true,
                  episode: { include: { script: true } },
                },
              },
            },
          })
        : null;
      if (input.intent && (!target || target.status === 'PASSED'))
        throw new PreparationConflictError('Class not found or already passed.');
      const requirements =
        (input.intent?.kind !== 'REGENERATE' && target
          ? readSkillRequirements(target.skillRequirements)
          : null) ??
        (await resolveSkillRequirementsInTransaction(database, execution, {
          scope: 'CLASS',
          nativeLang: course.nativeLang,
          targetLang: course.targetLang,
          level: (target && !target.sourceUrl && !target.sourceTitle
            ? target.lesson.level
            : course.currentLevel) as CefrLevel,
        }));
      const speechFingerprint = await learningSpeechFingerprint(
        database,
        execution.authorize,
        requirements,
        execution.signal
      );
      const proposed: ClassPreparation = {
        id,
        courseId,
        userId: actor.userId,
        instanceId: ownership.instanceId,
        courseCreatedAt: courseScope.generation,
        userCreatedAt: userScope.generation,
        createdAt: now,
        availableAt,
        expiresAt: availableAt + 86_400_000,
        updatedAt: now,
        selection,
        grant: delegationGrantBinding(grantSpec),
        maxProviderRequests,
        timeZone,
        deferAudio: input.deferAudio === true,
        inputFingerprint: createHash('sha256')
          .update(
            JSON.stringify({
              inputFingerprint,
              requirements,
              speechFingerprint,
              intent: input.intent
                ? {
                    kind: input.intent.kind,
                    classId: input.intent.classId,
                    expectedAttempt: input.intent.expectedAttempt,
                  }
                : null,
            })
          )
          .digest('hex'),
        requirements,
        courseLevel: course.currentLevel,
        speechFingerprint,
        status: 'QUEUED',
        classId: null,
        audioEpisodeIds: [],
        result: null,
        failure: null,
      };
      const store = classPreparationStore(database, courseId);
      let current = await store.read();
      if (
        input.intent &&
        current?.intent &&
        current.inputFingerprint === proposed.inputFingerprint &&
        current.userId === proposed.userId &&
        current.courseCreatedAt === proposed.courseCreatedAt &&
        current.userCreatedAt === proposed.userCreatedAt &&
        current.instanceId === proposed.instanceId &&
        current.intent.classId === input.intent.classId &&
        current.status === 'COMPLETED'
      )
        return current;
      if (current?.status === 'FAILED') {
        const cleanup = await settlePreparationCleanup(database, current);
        current = cleanup.operation;
        if (!cleanup.settled)
          throw new PreparationConflictError(
            'The previous preparation still needs execution cleanup.'
          );
      }
      const admitted = admitPreparation(current, proposed);
      if (admitted.id !== id) return admitted;
      if (input.intent && target) {
        if (
          input.intent.pristineSnapshot &&
          (await readPristine(database, target.id, actor.userId)).snapshot !==
            input.intent.pristineSnapshot
        )
          throw new PreparationConflictError('The pristine class changed before admission.');
        if (target.attempt !== input.intent.expectedAttempt)
          throw new PreparationConflictError(
            'The class attempt changed. Reload before starting a new regeneration.'
          );
        const attempt = await claimClassRegenerationInTransaction(
          database,
          execution,
          target.id,
          target,
          requirements
        );
        admitted.intent = {
          kind: input.intent.kind,
          classId: target.id,
          attempt,
          priorStatus: target.status,
          classFingerprint: targetFingerprint(target),
          skills:
            input.intent.kind === 'REPAIR'
              ? await selectClassRepairSkills(database, target, requirements)
              : (
                  Object.keys(requirements.skills) as Array<keyof typeof requirements.skills>
                ).filter((skill) => requirements.skills[skill].state === 'REQUIRED'),
        };
        admitted.classId = target.id;
      }
      await classPreparationGrant(database, admitted).create(preparationGrantSpec(admitted));
      const storage = classPreparationBackend(database, courseId);
      const snapshot = await storage.read();
      if (
        !(await storage.compareAndSwap(snapshot?.revision ?? null, {
          revision: randomUUID(),
          state: admitted,
        }))
      )
        throw new PreparationConflictError();
      await sottoJobOutbox(database).enqueue(
        prepareJob({
          id,
          namespace: SIDEDOOR_STATE_ID,
          handler: CLASS_PREPARATION_QUEUE,
          version: 1,
          payload,
          scopes: ownership.scopes,
          delivery: { attempts: 1, priority: 0, availableAt },
        })
      );
      return admitted;
    },
    { signal: execution.signal }
  );
}

async function reconcileKnownPreparationFailure(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const current = await validateClassPreparation(database, operation.courseId, operation.id, true);
  if (
    current.intent &&
    current.status === 'UNRESOLVED' &&
    (current.failure === 'generation_failed' || current.failure === 'source_unreadable')
  )
    return settleCancelledPreparation(database, current);
  return current;
}

export async function readClassPreparation(courseId: string, userId: string) {
  return sottoTransaction(prisma, async (database) => {
    const course = await database.course.findFirst({
      where: { id: courseId, userId },
      select: { id: true },
    });
    if (!course) return null;
    const operation = await classPreparationStore(database, courseId).read();
    if (!operation) return null;
    return reconcileKnownPreparationFailure(database, operation);
  });
}

export async function readPreparationActivity(
  courseId: string,
  execution: SottoProviderExecution,
  options: { after?: number; limit?: number } = {}
) {
  return sottoTransaction(
    prisma,
    async (database) => {
      const identity = await execution.authorize(database);
      if (identity.userId !== execution.userId)
        throw new PreparationConflictError('The learner changed.');
      let operation = await classPreparationStore(database, courseId).read();
      if (!operation) return null;
      if (operation.userId !== identity.userId)
        throw new PreparationConflictError('Course not found.');
      operation = await reconcileKnownPreparationFailure(database, operation);
      const grant = classPreparationGrant(database, operation);
      const record = await grant.read(operation.grant);
      const privateFailure =
        operation.status === 'FAILED' &&
        operation.failure === 'generation_failed' &&
        (await readLearningFailure(database, operation));
      const failureReason = privateFailure ? learningFailureReason(privateFailure) : undefined;
      return {
        operationId: operation.id,
        status: operation.status,
        availableAt: new Date(operation.availableAt).toISOString(),
        timeZone: operation.timeZone,
        aiProvider: operation.selection.provider,
        aiModel: operation.selection.model,
        maxProviderRequests: operation.maxProviderRequests,
        providerRequestsAdmitted:
          operation.maxProviderRequests === null ? null : record.attempts.length,
        audioRequiresReview: operation.deferAudio,
        ...(failureReason ? { failureReason } : {}),
        ...(await grant.activity(operation.grant, options)),
      };
    },
    { signal: execution.signal }
  );
}

export async function cancelClassPreparation(courseId: string, execution: SottoProviderExecution) {
  return sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      const operation = await classPreparationStore(database, courseId).read();
      if (!operation) return null;
      await validateClassPreparation(database, courseId, operation.id, true);
      if (actor.userId !== operation.userId)
        throw new PreparationConflictError('Course not found.');
      await classPreparationGrant(database, operation).revoke(operation.grant);
      const cancelled = await classPreparationStore(database, courseId).transact((current) => {
        if (!current || current.id !== operation.id) throw new PreparationConflictError();
        Object.assign(current, cancelPreparation(current, Date.now()));
        return current;
      });
      return settleCancelledPreparation(database, cancelled);
    },
    { signal: execution.signal }
  );
}

export async function settleCancelledPreparation(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  return (await settlePreparationCleanup(database, operation)).operation;
}

async function settlePreparationCleanup(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
): Promise<{ operation: ClassPreparation; settled: boolean }> {
  if (!['CANCELLING', 'CANCELLED', 'UNRESOLVED', 'FAILED'].includes(operation.status))
    return { operation, settled: false };
  const record = await sottoJobOutbox(database).read(operation.id);
  if (!record) throw new PreparationConflictError('The preparation receipt is missing.');
  const executions = sottoJobExecutions(database);
  if (await executions.blockingStatus(operation.id, record.fingerprint))
    return { operation, settled: false };
  await executions.requireParentDrained(operation.id, record.fingerprint);
  const audio = await settlePreparationAudio(database, operation);
  if (!audio.settled) return { operation, settled: false };
  if (operation.intent) {
    await database.courseClass.updateMany({
      where: {
        id: operation.intent.classId,
        courseId: operation.courseId,
        attempt: operation.intent.attempt,
        status: 'GENERATING',
      },
      data: { status: 'FAILED', failedAt: new Date() },
    });
  }
  if (!operation.intent && operation.classId && operation.result !== 'created') {
    const unpublished = await database.courseClass.findFirst({
      where: { id: operation.classId, courseId: operation.courseId, status: 'GENERATING' },
      select: { id: true },
    });
    if (unpublished) {
      await database.course.updateMany({
        where: { id: operation.courseId, activeClassId: unpublished.id },
        data: { activeClassId: null },
      });
      await database.courseClass.deleteMany({
        where: { id: unpublished.id, courseId: operation.courseId, status: 'GENERATING' },
      });
    }
  }
  await sottoJobOutbox(database).complete(operation.id, record.fingerprint);
  const settled = await classPreparationStore(database, operation.courseId).transact((current) => {
    if (!current || current.id !== operation.id) throw new PreparationConflictError();
    if (current.status !== 'FAILED')
      current.status =
        current.status === 'UNRESOLVED' &&
        (current.failure === 'generation_failed' || current.failure === 'source_unreadable')
          ? 'FAILED'
          : 'CANCELLED';
    current.updatedAt = Date.now();
    return current;
  });
  return { operation: settled, settled: true };
}

/** Acknowledgement never substitutes for execution or descendant cleanup receipts. */
export async function recoverClassPreparation(
  courseId: string,
  execution: SottoProviderExecution,
  input: { acknowledgeUnknownOutcome: true }
) {
  if (input.acknowledgeUnknownOutcome !== true)
    throw new PreparationConflictError(
      'Acknowledge that an interrupted provider request may have incurred charges.'
    );
  return sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      const operation = await classPreparationStore(database, courseId).read();
      if (!operation || actor.userId !== operation.userId || actor.userId !== execution.userId)
        throw new PreparationConflictError('Course not found.');
      await validateClassPreparation(database, courseId, operation.id, true);
      if (!['UNRESOLVED', 'CANCELLING', 'CANCELLED'].includes(operation.status)) return operation;
      await classPreparationGrant(database, operation).revoke(operation.grant);
      const recovered = await settlePreparationCleanup(database, operation);
      if (!recovered.settled)
        throw new PreparationConflictError(
          'Execution cleanup is not confirmed. Wait for active work or complete operator recovery.'
        );
      return recovered.operation;
    },
    { signal: execution.signal }
  );
}

/** A committed publication wins over a lost acknowledgement or later failure observation. */
export async function recordClassPreparationFailure(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  fingerprint: string,
  uncertain: boolean,
  failure: 'generation_failed' | 'source_unreadable' = 'generation_failed',
  diagnostic?: LearningFailure
) {
  const admitted = await validateClassPreparation(database, operation.courseId, operation.id, true);
  if (admitted.status === 'COMPLETED') return;
  await classPreparationGrant(database, admitted).revoke(admitted.grant);
  const failed = await classPreparationStore(database, operation.courseId).transact((current) => {
    if (!current || current.id !== operation.id) throw new PreparationConflictError();
    const cancelled = current.status === 'CANCELLING';
    Object.assign(current, {
      status: uncertain
        ? 'UNRESOLVED'
        : cancelled
          ? current.audioEpisodeIds.length > 0
            ? 'CANCELLING'
            : 'CANCELLED'
          : current.audioEpisodeIds.length > 0
            ? 'UNRESOLVED'
            : 'FAILED',
      failure: uncertain ? 'interrupted' : cancelled ? null : failure,
      updatedAt: Date.now(),
    });
    return current;
  });
  if (
    diagnostic &&
    !['CANCELLING', 'CANCELLED'].includes(admitted.status) &&
    ((['FAILED', 'UNRESOLVED'].includes(failed.status) && failed.failure === 'generation_failed') ||
      (uncertain && failed.status === 'UNRESOLVED'))
  )
    await writeLearningFailure(database, failed, fingerprint, diagnostic);
  if (!uncertain) await sottoJobOutbox(database).complete(operation.id, fingerprint);
}

export function preparationProgress(operation: ClassPreparation) {
  const detail = {
    QUEUED: 'Preparation is saved and will run when a worker is available.',
    RUNNING: 'Preparing this class from your course, notes, and review targets.',
    CANCELLING: 'Stopping preparation and waiting for active work to settle.',
    CANCELLED: 'Preparation was cancelled.',
    COMPLETED: 'Preparation finished.',
    FAILED: 'Preparation failed. You can start a new attempt.',
    UNRESOLVED:
      'Preparation was interrupted. Recovery is required before starting another attempt.',
  }[operation.status];
  return {
    operationId: operation.id,
    operationStatus: operation.status,
    status:
      operation.status === 'QUEUED' || operation.status === 'RUNNING'
        ? 'GENERATING'
        : operation.status,
    classId: operation.classId,
    lessonTitle: null,
    stage: operation.status === 'QUEUED' ? 'Queued preparation' : 'Class preparation',
    detail,
    progress: 0,
    currentStep: 0,
    totalSteps: 6,
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - operation.createdAt) / 1000)),
    remainingSeconds: null,
    availableAt: new Date(operation.availableAt).toISOString(),
    updatedAt: new Date(operation.updatedAt).toISOString(),
    sections: [],
    timeZone: operation.timeZone,
    maxProviderRequests: operation.maxProviderRequests,
    requestBudgetScope: operation.maxProviderRequests === null ? null : 'parent-preparation',
    aiProvider: operation.selection.provider,
    aiModel: operation.selection.model,
    audioRequiresReview: operation.deferAudio,
    audioEpisodeIds: operation.audioEpisodeIds,
  };
}
