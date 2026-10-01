import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '../prisma';
import type { PracticeKind } from '@sotto/shared';
import { capturePracticeContext } from '../practice-service';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '../sidedoor/access/state/store';
import { captureCourseStorage } from '../sidedoor/storage/core/course-storage';
import { sottoJobOutbox } from '../sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '../sidedoor/jobs/core/job-execution-lifetime';
import { resolveCapturedLearningAi, captureLearningModerationCredential } from '../learning-ai';
import { validateSottoExecutionCredential } from '../sidedoor/credentials/runtime/credential-execution';
import { learningCredentialFingerprint } from '../classes/preparation-selection';
import {
  learningPreparationGrant,
  learningPreparationGrantSpec,
} from '../learning/preparation/preparation-grant';
import { learningSpeechFingerprint } from '../learning/speech-configuration';
import { resolveSkillRequirementsInTransaction } from '../learning/skill-requirements';
import { cancelPreparation, PreparationConflictError } from '../classes/preparation-state';
import {
  practiceGenerationSchema,
  practicePreparationSchema,
  type PracticePreparation,
} from './preparation-state';

export const PRACTICE_PREPARATION_QUEUE = 'practice-preparation';
export const practicePreparationPayload = z
  .object({ sessionId: z.uuid(), operationId: z.uuid() })
  .strict();
const inputHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const practicePreparationGrant = (
  database: Prisma.TransactionClient,
  operation: Pick<PracticePreparation, 'id' | 'courseId' | 'userId'>
) => learningPreparationGrant(database, operation, 'practice');

export function practicePreparationProgress(
  operation: PracticePreparation
): import('@sotto/shared').PracticePreparing {
  const messages = {
    QUEUED: 'Practice is saved and waiting for a worker.',
    RUNNING: 'Preparing exercises and reference audio.',
    CANCELLING: 'Stopping generation and waiting for active work to settle.',
    CANCELLED: 'Practice generation was cancelled.',
    COMPLETED: 'Practice preparation finished.',
    FAILED: 'Practice generation failed. You can start a new attempt.',
    UNRESOLVED: 'Generation was interrupted. Execution cleanup must be confirmed before recovery.',
  };
  return {
    status: 'preparing',
    sessionId: operation.sessionId,
    preparationStatus: operation.status,
    message: messages[operation.status],
    canRecover: ['UNRESOLVED', 'CANCELLING'].includes(operation.status),
  };
}

/** Caller owns the transaction, including the session lock and durable job metadata. */
export async function readPracticePreparation(
  database: Prisma.TransactionClient,
  sessionId: string
) {
  await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${sessionId} FOR UPDATE`;
  const session = await database.practiceSession.findUnique({ where: { id: sessionId } });
  if (!session?.generationState)
    throw new PreparationConflictError('Practice preparation not found.');
  const operation = practicePreparationSchema.parse(session.generationState);
  const generation = practiceGenerationSchema.parse(session.generationSpec);
  if (
    operation.sessionId !== session.id ||
    generation.course.id !== operation.courseId ||
    generation.course.userId !== operation.userId ||
    inputHash(generation) !== operation.inputFingerprint ||
    !isDeepStrictEqual(session.skillRequirements, generation.requirements)
  )
    throw new PreparationConflictError('Practice preparation inputs changed.');
  return { session, operation, generation };
}

export async function validatePracticePreparation(
  database: Prisma.TransactionClient,
  sessionId: string,
  operationId: string,
  allowTerminal = false
) {
  const work = await readPracticePreparation(database, sessionId);
  const { operation } = work;
  if (operation.id !== operationId)
    throw new PreparationConflictError('Practice preparation identity changed.');
  const ownership = await captureCourseStorage(database, operation.courseId);
  if (
    ownership.instanceId !== operation.instanceId ||
    ownership.userId !== operation.userId ||
    !ownership.scopes.some(
      (scope) =>
        scope.subjectId === `profile:${operation.userId}` &&
        scope.generation === operation.userCreatedAt
    ) ||
    !ownership.scopes.some(
      (scope) =>
        scope.subjectId === `course:${operation.courseId}` &&
        scope.generation === operation.courseCreatedAt
    )
  )
    throw new PreparationConflictError('The practice preparation owner changed.');
  if (!allowTerminal) {
    if (operation.status !== 'RUNNING' || Date.now() >= operation.expiresAt)
      throw new PreparationConflictError('Practice preparation is no longer authorized.');
    await practicePreparationGrant(database, operation).validate(operation.grant);
    await validatePracticeSpeechConfiguration(database, work);
  }
  return work;
}

export async function validatePracticeSpeechConfiguration(
  database: Prisma.TransactionClient,
  work: Awaited<ReturnType<typeof readPracticePreparation>>
) {
  // The caller validates the original course, profile and grant before delegation.
  if (
    (await learningSpeechFingerprint(
      database,
      async () => ({ userId: work.operation.userId }),
      work.generation.requirements
    )) !== work.operation.speechFingerprint
  )
    throw new PreparationConflictError(
      'The selected speech model, endpoint or credential changed.'
    );
}

export async function writePracticePreparation(
  database: Prisma.TransactionClient,
  operation: PracticePreparation,
  data: Prisma.PracticeSessionUpdateInput = {}
) {
  return database.practiceSession.update({
    where: { id: operation.sessionId },
    data: { ...data, generationState: operation },
  });
}

/** Stable client identity makes a lost accepted response safe to retry. */
export async function requestPracticePreparation(
  courseId: string,
  kind: PracticeKind,
  execution: SottoProviderExecution,
  input: { requestId?: string; focusTargetId?: string } = {}
) {
  const sessionId = input.requestId ?? randomUUID();
  z.uuid().parse(sessionId);
  const existing = await sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      const session = await database.practiceSession.findFirst({
        where: { id: sessionId, course: { userId: actor.userId } },
        select: { courseId: true, kind: true, generationState: true },
      });
      if (!session) {
        if (
          await database.practiceRequestReceipt.findUnique({
            where: { id: sessionId },
            select: { id: true },
          })
        )
          throw new PreparationConflictError(
            'This admitted practice request was discarded. Start new work with a new request ID.'
          );
        return null;
      }
      if (session.courseId !== courseId || session.kind !== kind || !session.generationState)
        throw new PreparationConflictError('This practice request ID belongs to different work.');
      const operation = practicePreparationSchema.parse(session.generationState);
      if (operation.focusTargetId !== (input.focusTargetId ?? null))
        throw new PreparationConflictError(
          'This practice request ID belongs to a different focus target.'
        );
      return operation;
    },
    { signal: execution.signal }
  );
  if (existing) return existing;
  const generation = practiceGenerationSchema.parse(
    await capturePracticeContext(courseId, execution.userId, kind, execution, input)
  );
  const ai = await resolveCapturedLearningAi(execution.userId, execution);
  const moderation = await captureLearningModerationCredential(execution);
  const now = Date.now();
  const id = randomUUID();
  const selection = {
    provider: ai.provider,
    model: ai.model,
    ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
    ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
    credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
    moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
  };
  return sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== generation.course.userId)
        throw new PreparationConflictError('The learner changed.');
      const duplicate = await database.practiceSession.findUnique({
        where: { id: sessionId },
        select: { generationState: true, courseId: true, kind: true },
      });
      if (duplicate) {
        const previous = practicePreparationSchema.parse(duplicate.generationState);
        if (
          previous.userId !== actor.userId ||
          duplicate.courseId !== courseId ||
          duplicate.kind !== kind ||
          previous.focusTargetId !== (input.focusTargetId ?? null)
        )
          throw new PreparationConflictError('This request ID belongs to different practice.');
        return previous;
      }
      if (
        await database.practiceRequestReceipt.findUnique({
          where: { id: sessionId },
          select: { id: true },
        })
      )
        throw new PreparationConflictError(
          'This practice request was already admitted and discarded.'
        );
      if (ai.execution.credential)
        await validateSottoExecutionCredential(
          database,
          execution.authorize,
          ai.execution.credential,
          execution.signal
        );
      if (moderation)
        await validateSottoExecutionCredential(
          database,
          execution.authorize,
          moderation,
          execution.signal
        );
      const course = await database.course.findFirst({
        where: { id: courseId, userId: actor.userId },
        select: {
          id: true,
          userId: true,
          nativeLang: true,
          targetLang: true,
          currentLevel: true,
          curriculumId: true,
          pedagogy: true,
        },
      });
      if (!isDeepStrictEqual(course, generation.course))
        throw new PreparationConflictError('The course changed before practice admission.');
      const requirements = await resolveSkillRequirementsInTransaction(database, execution, {
        scope: kind,
        nativeLang: generation.course.nativeLang,
        targetLang: generation.course.targetLang,
        level: generation.course.currentLevel,
      });
      if (!isDeepStrictEqual(requirements, generation.requirements))
        throw new PreparationConflictError(
          'Speech requirements changed before practice admission.'
        );
      const ownership = await captureCourseStorage(database, courseId);
      const courseScope = ownership.scopes.find(
        (scope) => scope.subjectId === `course:${courseId}`
      )!;
      const profileScope = ownership.scopes.find(
        (scope) => scope.subjectId === `profile:${actor.userId}`
      )!;
      const grantSpec = {
        id,
        revision: randomUUID(),
        instanceId: ownership.instanceId,
        subject: { id: profileScope.subjectId, generation: profileScope.generation },
        resource: { id: courseScope.subjectId, generation: courseScope.generation },
        operationId: id,
        action: 'practice-parent-provider-request',
        expiresAt: now + 86_400_000,
        maxRequests: 256,
      };
      const operation = practicePreparationSchema.parse({
        id,
        sessionId,
        courseId,
        userId: actor.userId,
        instanceId: ownership.instanceId,
        courseCreatedAt: courseScope.generation,
        userCreatedAt: profileScope.generation,
        createdAt: now,
        availableAt: now,
        expiresAt: grantSpec.expiresAt,
        updatedAt: now,
        selection,
        grant: delegationGrantBinding(grantSpec),
        inputFingerprint: inputHash(generation),
        speechFingerprint: await learningSpeechFingerprint(
          database,
          execution.authorize,
          requirements,
          execution.signal
        ),
        focusTargetId: input.focusTargetId ?? null,
        status: 'QUEUED',
        audioEpisodeIds: [],
        failure: null,
        maxProviderRequests: 256,
        unavailableReason: null,
      });
      await database.practiceSession.create({
        data: {
          id: sessionId,
          courseId,
          kind,
          status: 'GENERATING',
          items: [],
          seed: generation.seedToken,
          skillRequirements: requirements,
          generationSpec: generation,
          generationState: operation,
        },
      });
      await database.practiceRequestReceipt.create({ data: { id: sessionId, courseId } });
      await practicePreparationGrant(database, operation).create(
        learningPreparationGrantSpec(operation, 'practice')
      );
      await sottoJobOutbox(database).enqueue(
        prepareJob({
          id,
          namespace: SIDEDOOR_STATE_ID,
          handler: PRACTICE_PREPARATION_QUEUE,
          version: 1,
          payload: { sessionId, operationId: id },
          scopes: ownership.scopes,
          delivery: { attempts: 1, priority: 0, availableAt: now },
        })
      );
      return operation;
    },
    { signal: execution.signal }
  );
}

async function settlePracticeCancellation(
  database: Prisma.TransactionClient,
  operation: PracticePreparation
) {
  const record = await sottoJobOutbox(database).read(operation.id);
  if (!record) throw new PreparationConflictError('The preparation receipt is missing.');
  if (await sottoJobExecutions(database).blockingStatus(operation.id, record.fingerprint))
    return operation;
  await sottoJobExecutions(database).requireParentDrained(operation.id, record.fingerprint);
  if (operation.audioEpisodeIds.length) {
    const { settlePreparationAudio } = await import('../classes/preparation-audio-settlement');
    if (!(await settlePreparationAudio(database, operation, 'practice')).settled) return operation;
  }
  const settled =
    operation.status === 'CANCELLING'
      ? { ...operation, status: 'CANCELLED' as const, updatedAt: Date.now() }
      : operation;
  const session = await database.practiceSession.findUniqueOrThrow({
    where: { id: operation.sessionId },
    select: { status: true },
  });
  const published = session.status === 'ACTIVE' || session.status === 'COMPLETED';
  await writePracticePreparation(
    database,
    settled,
    settled.status === 'CANCELLED' && !published ? { status: 'CANCELLED' } : {}
  );
  await sottoJobOutbox(database).complete(operation.id, record.fingerprint);
  return settled;
}

/** Polling reconciles receipts, never retries provider work or confirms orphan cleanup. */
export async function reconcilePracticePreparation(sessionId: string, userId: string) {
  return sottoTransaction(prisma, async (database) => {
    if (
      !(await database.practiceSession.findFirst({
        where: { id: sessionId, course: { userId } },
        select: { id: true },
      }))
    )
      throw new PreparationConflictError('Practice preparation not found.');
    const { operation } = await validatePracticePreparation(
      database,
      sessionId,
      (await readPracticePreparation(database, sessionId)).operation.id,
      true
    );
    if (operation.status === 'CANCELLING') return settlePracticeCancellation(database, operation);
    if (operation.status !== 'RUNNING') return operation;
    const record = await sottoJobOutbox(database).read(operation.id);
    if (!record) throw new PreparationConflictError('The preparation receipt is missing.');
    const blocker = await sottoJobExecutions(database).blockingStatus(
      operation.id,
      record.fingerprint
    );
    if (blocker !== 'cleanup-unconfirmed' && Date.now() - operation.updatedAt <= 30_000)
      return operation;
    // A missed heartbeat fences fresh dispatches; the execution journal still owns cleanup.
    await practicePreparationGrant(database, operation).revoke(operation.grant);
    const unresolved = {
      ...operation,
      status: 'UNRESOLVED' as const,
      failure: 'interrupted' as const,
      updatedAt: Date.now(),
    };
    await writePracticePreparation(database, unresolved);
    return unresolved;
  });
}

export async function cancelPracticePreparation(
  sessionId: string,
  execution: SottoProviderExecution,
  acknowledgeUnknownOutcome = false,
  discard = false
) {
  return sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      const { operation, session } = await readPracticePreparation(database, sessionId);
      await validatePracticePreparation(database, sessionId, operation.id, true);
      if (actor.userId !== operation.userId)
        throw new PreparationConflictError('Practice preparation not found.');
      if (!discard && (session.status === 'ACTIVE' || session.status === 'COMPLETED'))
        throw new PreparationConflictError(
          'Practice exercises are already published. Resume them or explicitly delete the session.'
        );
      if (operation.status === 'UNRESOLVED' && !acknowledgeUnknownOutcome)
        throw new PreparationConflictError(
          'Acknowledge that interrupted provider work may have incurred charges before recovery.'
        );
      await practicePreparationGrant(database, operation).revoke(operation.grant);
      const cancelled =
        operation.status === 'UNRESOLVED'
          ? { ...operation, status: 'CANCELLING' as const }
          : cancelPreparation(operation, Date.now());
      await writePracticePreparation(database, cancelled);
      return settlePracticeCancellation(database, cancelled);
    },
    { signal: execution.signal }
  );
}
