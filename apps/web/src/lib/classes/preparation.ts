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
  admitPreparation,
  cancelPreparation,
  preparationStore,
  PreparationConflictError,
  type ClassPreparation,
} from './preparation-state';

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
  if (!allowTerminal) await classPreparationGrant(database, operation).validate(operation.grant);
  return operation;
}

/** The operation and outbox record commit before callers receive an accepted response. */
export async function requestClassPreparation(
  courseId: string,
  execution: SottoProviderExecution,
  input: {
    sourceUrl?: string;
    topic?: string;
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
        inputFingerprint,
        status: 'QUEUED',
        classId: null,
        audioEpisodeIds: [],
        result: null,
        failure: null,
      };
      const store = classPreparationStore(database, courseId);
      let current = await store.read();
      if (current?.status === 'FAILED') {
        current = await settleCancelledPreparation(database, current);
        if (current.status !== 'CANCELLED')
          throw new PreparationConflictError(
            'The previous preparation still needs execution cleanup.'
          );
      }
      const admitted = admitPreparation(current, proposed);
      if (admitted.id !== id) return admitted;
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

export async function readClassPreparation(courseId: string, userId: string) {
  return sottoTransaction(prisma, async (database) => {
    const course = await database.course.findFirst({
      where: { id: courseId, userId },
      select: { id: true },
    });
    if (!course) return null;
    const operation = await classPreparationStore(database, courseId).read();
    if (!operation) return null;
    return validateClassPreparation(database, courseId, operation.id, true);
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
      const operation = await classPreparationStore(database, courseId).read();
      if (!operation) return null;
      if (operation.userId !== identity.userId)
        throw new PreparationConflictError('Course not found.');
      await validateClassPreparation(database, courseId, operation.id, true);
      const grant = classPreparationGrant(database, operation);
      const record = await grant.read(operation.grant);
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

async function settleCancelledPreparation(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  if (!['CANCELLING', 'CANCELLED', 'UNRESOLVED', 'FAILED'].includes(operation.status))
    return operation;
  const record = await sottoJobOutbox(database).read(operation.id);
  if (!record) throw new PreparationConflictError('The preparation receipt is missing.');
  const executions = sottoJobExecutions(database);
  if (await executions.blockingStatus(operation.id, record.fingerprint)) return operation;
  await executions.requireParentDrained(operation.id, record.fingerprint);
  const audio = await settlePreparationAudio(database, operation);
  if (!audio.settled) return operation;
  if (operation.classId && operation.result !== 'created') {
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
  return classPreparationStore(database, operation.courseId).transact((current) => {
    if (!current || current.id !== operation.id) throw new PreparationConflictError();
    current.status = 'CANCELLED';
    current.updatedAt = Date.now();
    return current;
  });
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
      const recovered = await settleCancelledPreparation(database, operation);
      if (recovered.status !== 'CANCELLED')
        throw new PreparationConflictError(
          'Execution cleanup is not confirmed. Wait for active work or complete operator recovery.'
        );
      return recovered;
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
  failure: 'generation_failed' | 'source_unreadable' = 'generation_failed'
) {
  const admitted = await validateClassPreparation(database, operation.courseId, operation.id, true);
  if (admitted.status === 'COMPLETED') return;
  await classPreparationGrant(database, admitted).revoke(admitted.grant);
  await classPreparationStore(database, operation.courseId).transact((current) => {
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
  });
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
