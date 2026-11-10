import { type CefrLevel } from '@sotto/shared';
import { resolveSkillRequirementsInTransaction } from '../learning/skill-requirements';
import { readSkillRequirements } from '../learning/skill-requirements';
import {
  requireRepairQuizFence,
  quizRetrySourceDigest,
  retainedQuizReceipt,
  selectClassRepairSkills,
} from '../learning/classes/formative/class-repair';
import { captureClassQuizRetry } from '../learning/classes/formative/class-quiz-retry';
import { claimClassRegenerationInTransaction } from '../learning/classes/formative/class-generation-state';
import { readPristine } from './regeneration/pristine';
import { targetFingerprint } from './regeneration/target-fingerprint';
export { preparationProgress } from './generation/preparation-progress';
import { learningSpeechFingerprint } from '../learning/speech-configuration';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { z } from 'zod';
import { delegationGrantBinding, type DelegationGrant } from 'thesidedoor-core/runtime/delegation';
import { Prisma } from '@/generated/prisma/client';
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
import { writingRepairSourceHash } from './repair/writing-repair-source';
import { speakingRepairSourceHash } from './repair/speaking-repair-source';
import {
  hasUnsettledClassSpeakingReferenceWrites,
  hasUnsettledSpeakingReferenceWrites,
} from './speaking/speaking-write-settlement';
import { grammarRepairSourceHash } from './repair/grammar-repair-source';
import { requireStageGuard } from './staging/stage-guard';
import { isEmptyLegacyPreparationCleanup } from './preparation/legacy-cleanup';
import {
  readLearningFailure,
  writeLearningFailure,
  learningFailureReason,
  type LearningFailure,
} from './quality/teaching-failure-store';
import {
  admitPreparation,
  cancelPreparation,
  PreparationConflictError,
  newClassPreparationId,
  type ClassPreparation,
} from './preparation-state';

import {
  CLASS_PREPARATION_QUEUE,
  classPreparationBackend,
  classPreparationPayload,
  classPreparationStore,
  validateClassPreparation,
  validatePreparationSchedule,
} from './preparation/runtime';
export {
  CLASS_PREPARATION_QUEUE,
  classPreparationBackend,
  classPreparationPayload,
  classPreparationStore,
  validateClassPreparation,
} from './preparation/runtime';

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
      retry?: { sectionId: string; expectedRevision: number };
    };
    availableAt?: number;
    maxProviderRequests?: number;
    deferAudio?: boolean;
    timeZone?: string;
    expectedPreviousPreparation?: { operationId: string; classId: string };
  } = {}
): Promise<ClassPreparation> {
  const now = Date.now();
  const { availableAt, budgeted, maxProviderRequests, timeZone } = validatePreparationSchedule(
    input,
    now
  );
  const revision = randomUUID();
  classPreparationPayload.parse({
    courseId,
    operationId: revision,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
  });
  if (input.expectedPreviousPreparation && input.intent)
    throw new PreparationConflictError('Choose either a new class or an existing class.');
  const inputFingerprint = createHash('sha256')
    .update(JSON.stringify({ sourceUrl: input.sourceUrl || null, topic: input.topic || null }))
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
  const previous = await sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId) throw new PreparationConflictError();
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
      if (!input.intent) {
        const course = await database.course.findFirst({
          where: { id: courseId, userId: actor.userId },
          select: { nativeLang: true, targetLang: true, currentLevel: true },
        });
        if (!course) throw new PreparationConflictError('Course not found.');
        const requirements = await resolveSkillRequirementsInTransaction(database, execution, {
          scope: 'CLASS',
          nativeLang: course.nativeLang,
          targetLang: course.targetLang,
          level: course.currentLevel as CefrLevel,
        });
        await learningSpeechFingerprint(
          database,
          execution.authorize,
          requirements,
          execution.signal
        );
      }
      if (input.expectedPreviousPreparation) {
        const cls = await database.courseClass.findUnique({
          where: { id: input.expectedPreviousPreparation.classId },
          select: { courseId: true, status: true },
        });
        if (cls && (cls.courseId !== courseId || cls.status !== 'GENERATING'))
          throw new PreparationConflictError('The unpublished class changed. Refresh its status.');
        return input.expectedPreviousPreparation;
      }
      if (input.intent) return null;
      const current = await classPreparationStore(database, courseId).read();
      if (
        !current ||
        current.userId !== actor.userId ||
        current.intent ||
        current.result === 'created' ||
        !current.classId ||
        !['FAILED', 'CANCELLED'].includes(current.status)
      )
        return null;
      return { operationId: current.id, classId: current.classId };
    },
    { signal: execution.signal }
  );
  if (previous) await cancelClassPreparation(courseId, execution, previous);
  const result = await sottoTransaction(
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
      const course = await database.course.findUniqueOrThrow({
        where: { id: courseId },
        select: {
          nativeLang: true,
          targetLang: true,
          currentLevel: true,
        },
      });
      const store = classPreparationStore(database, courseId);
      let current = await store.read();
      if (input.expectedPreviousPreparation) {
        const expected = input.expectedPreviousPreparation;
        if (
          !current ||
          current.id !== expected.operationId ||
          current.classId !== expected.classId ||
          current.intent ||
          current.result === 'created' ||
          !['FAILED', 'CANCELLED'].includes(current.status)
        )
          throw new PreparationConflictError('The failed preparation changed. Refresh its status.');
        await validateClassPreparation(database, courseId, current.id, true);
      }
      if (current?.status === 'FAILED' || current?.status === 'CANCELLED') {
        const cleanup = await settlePreparationCleanup(database, current);
        current = cleanup.operation;
        if (!cleanup.settled) return { cleanupBlocked: true as const };
        if (cleanup.cleanupClass) {
          const { recoverPrerequisiteClassDeletion } = await import('./help/prerequisite-deletion');
          const recovered = await recoverPrerequisiteClassDeletion(
            database,
            cleanup.cleanupClass.id,
            current.userId,
            {
              operationId: current.id,
              attempt: cleanup.cleanupClass.attempt,
              createdAt: cleanup.cleanupClass.createdAt,
            }
          );
          if (
            !recovered ||
            recovered.phase !== 'complete' ||
            recovered.episodeJobs.some((job) => job.phase !== 'complete')
          )
            return { cleanupBlocked: true as const };
        }
        if (
          input.expectedPreviousPreparation &&
          (await database.courseClass.findUnique({
            where: { id: input.expectedPreviousPreparation.classId },
            select: { id: true },
          }))
        )
          throw new PreparationConflictError('The unpublished class changed. Refresh its status.');
      }
      if (input.intent)
        await database.$queryRaw`
          SELECT cls.id FROM "CourseClass" cls
          JOIN "Course" course ON course.id = cls."courseId"
          WHERE cls.id = ${input.intent.classId} AND course.id = ${courseId}
            AND course."userId" = ${actor.userId}
          FOR UPDATE OF cls
        `;
      if (input.intent?.retry) {
        await requireRepairQuizFence(database);
        await database.$queryRaw`
          SELECT s.id FROM "ClassSection" s
          JOIN "CourseClass" cls ON cls.id = s."classId"
          JOIN "Course" course ON course.id = cls."courseId"
          WHERE cls.id = ${input.intent.classId} AND course.id = ${courseId}
            AND course."userId" = ${actor.userId}
          ORDER BY s.id FOR UPDATE OF s
        `;
      }
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
      const initialA1Class =
        requirements.level === 'A1' &&
        !(await database.courseClass.findFirst({
          where: {
            courseId,
            status: 'PASSED',
            skillRequirements: { path: ['level'], equals: 'A1' },
            ...(target ? { createdAt: { lt: target.createdAt } } : {}),
          },
          select: { id: true },
        }));
      const id = newClassPreparationId(initialA1Class);
      const payload = classPreparationPayload.parse({
        courseId,
        operationId: id,
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        ...(input.topic ? { topic: input.topic } : {}),
      });
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
      const speechFingerprint = await learningSpeechFingerprint(
        database,
        execution.authorize,
        requirements,
        execution.signal
      );
      let retry: NonNullable<NonNullable<ClassPreparation['intent']>['retry']> | undefined;
      let retrySkill: 'GRAMMAR' | 'READING' | 'LISTENING' | undefined;
      if (input.intent?.retry) {
        if (input.intent.kind !== 'REPAIR' || !target)
          throw new PreparationConflictError('A quiz retry requires an owned class repair.');
        const request = { ...input.intent.retry, expectedAttempt: input.intent.expectedAttempt };
        const previous = current?.intent?.retry;
        if (
          previous &&
          previous.sectionId === request.sectionId &&
          previous.expectedAttempt === request.expectedAttempt &&
          previous.expectedRevision === request.expectedRevision &&
          current?.intent?.classId === target.id &&
          current.intent.attempt === target.attempt &&
          ['QUEUED', 'RUNNING', 'CANCELLING', 'UNRESOLVED', 'COMPLETED'].includes(current.status)
        ) {
          const skill = current.intent.skills[0];
          if (
            current.intent.skills.length !== 1 ||
            (skill !== 'GRAMMAR' && skill !== 'READING' && skill !== 'LISTENING')
          )
            throw new PreparationConflictError('The admitted quiz retry target changed.');
          retry = previous;
          retrySkill = skill;
        } else {
          const captured = captureClassQuizRetry(target, requirements, request);
          retry = {
            sectionId: request.sectionId,
            expectedAttempt: request.expectedAttempt,
            expectedRevision: request.expectedRevision,
            context: captured.context,
            ...(captured.skill === 'READING'
              ? { readingVocabulary: z.json().parse(target.readingVocabulary) }
              : {}),
          };
          retrySkill = captured.skill;
        }
      }
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
                    ...(retry
                      ? {
                          retry: {
                            sectionId: retry.sectionId,
                            expectedAttempt: retry.expectedAttempt,
                            expectedRevision: retry.expectedRevision,
                            context: retry.context,
                            ...(retry.readingVocabulary !== undefined
                              ? { readingVocabulary: retry.readingVocabulary }
                              : {}),
                          },
                        }
                      : {}),
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
          ...(retry ? { retry } : {}),
          skills: retrySkill
            ? [retrySkill]
            : input.intent.kind === 'REPAIR'
              ? await selectClassRepairSkills(database, target, requirements, true)
              : (
                  Object.keys(requirements.skills) as Array<keyof typeof requirements.skills>
                ).filter((skill) => requirements.skills[skill].state === 'REQUIRED'),
        };
        if (input.intent.kind === 'REPAIR') {
          await requireRepairQuizFence(database);
          admitted.intent.retainedQuiz = retainedQuizReceipt(target, admitted.intent.skills);
          if (admitted.intent.skills.includes('GRAMMAR'))
            admitted.intent.grammarSourceHash = await grammarRepairSourceHash(
              database,
              target.id,
              attempt
            );
          if (admitted.intent.skills.includes('WRITING'))
            admitted.intent.writingSourceHash = await writingRepairSourceHash(
              database,
              target.id,
              attempt
            );
          if (admitted.intent.skills.includes('SPEAKING'))
            admitted.intent.speakingSourceHash = await speakingRepairSourceHash(
              database,
              target.id,
              attempt
            );
          if (admitted.intent.retry && retrySkill)
            admitted.intent.retry.sourceReceipt = {
              version: 1,
              digest: quizRetrySourceDigest(target, retrySkill, attempt),
            };
        }
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
  if ('cleanupBlocked' in result)
    throw new PreparationConflictError('The previous preparation still needs execution cleanup.');
  return result;
}

async function reconcileKnownPreparationFailure(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const current = await validateClassPreparation(database, operation.courseId, operation.id, true);
  if (
    current.intent &&
    ((current.status === 'UNRESOLVED' &&
      (current.failure === 'generation_failed' || current.failure === 'source_unreadable')) ||
      ['FAILED', 'CANCELLED'].includes(current.status))
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
    const reconciled = await reconcileKnownPreparationFailure(database, operation);
    if (reconciled.intent) return reconciled;
    const receipt = await sottoJobOutbox(database).read(reconciled.id);
    const payload = classPreparationPayload.safeParse(receipt?.job.payload);
    if (
      receipt?.job.namespace !== SIDEDOOR_STATE_ID ||
      receipt.job.handler !== CLASS_PREPARATION_QUEUE ||
      receipt.job.version !== 1 ||
      !payload.success ||
      payload.data.courseId !== courseId ||
      payload.data.operationId !== reconciled.id
    )
      throw new PreparationConflictError('The initial preparation receipt changed.');
    return {
      ...reconciled,
      initialPreparation: {
        sourceUrl: payload.data.sourceUrl ?? null,
        topic: payload.data.topic ?? null,
      },
    };
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
        providerRequestsCompleted: record.attempts.filter(
          (attempt) => attempt.outcome === 'succeeded'
        ).length,
        providerRequestInFlight: record.attempts.some((attempt) => attempt.outcome === 'admitted'),
        updatedAt: new Date(
          Math.max(
            operation.updatedAt,
            ...record.attempts.map((attempt) => attempt.settledAt ?? attempt.admittedAt)
          )
        ).toISOString(),
        audioRequiresReview: operation.deferAudio,
        ...(failureReason ? { failureReason } : {}),
        ...(await grant.activity(operation.grant, options)),
      };
    },
    { signal: execution.signal }
  );
}

export async function cancelClassPreparation(
  courseId: string,
  execution: SottoProviderExecution,
  terminalCleanup?: { operationId: string; classId: string }
) {
  const result = await sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      const operation = await classPreparationStore(database, courseId).read();
      if (!operation) {
        if (terminalCleanup) throw new PreparationConflictError('The failed preparation changed.');
        return { operation: null, cleanupClass: null };
      }
      await validateClassPreparation(database, courseId, operation.id, true);
      if (actor.userId !== operation.userId)
        throw new PreparationConflictError('Course not found.');
      if (
        terminalCleanup &&
        (operation.id !== terminalCleanup.operationId ||
          operation.classId !== terminalCleanup.classId ||
          operation.intent ||
          operation.result === 'created' ||
          !['FAILED', 'CANCELLED'].includes(operation.status))
      )
        throw new PreparationConflictError('The failed preparation changed. Refresh its status.');
      await classPreparationGrant(database, operation).revoke(operation.grant);
      const cancelled = await classPreparationStore(database, courseId).transact((current) => {
        if (!current || current.id !== operation.id) throw new PreparationConflictError();
        Object.assign(current, cancelPreparation(current, Date.now()));
        return current;
      });
      const cleanup = await settlePreparationCleanup(database, cancelled);
      if (cleanup.cleanupClass) return cleanup;
      if (!terminalCleanup) return { operation: cleanup.operation, cleanupClass: null };
      if (
        !cleanup.settled ||
        (await database.courseClass.findUnique({
          where: { id: terminalCleanup.classId },
          select: { id: true },
        }))
      )
        throw new PreparationConflictError(
          'Execution cleanup is not confirmed. Check status before removing this class.'
        );
      return { operation: cleanup.operation, cleanupClass: null };
    },
    { signal: execution.signal }
  );
  if (!result.cleanupClass || !result.operation) return result.operation;
  const { deleteClassForUser } = await import('./deletion/class-deletion');
  try {
    const deleted = await deleteClassForUser(result.cleanupClass.id, execution.userId, execution, {
      operationId: result.operation.id,
      courseId,
      createdAt: result.cleanupClass.createdAt,
      attempt: result.cleanupClass.attempt,
    });
    if (!deleted) throw new PreparationConflictError('The unpublished class changed.');
  } catch (error) {
    if (error instanceof PreparationConflictError) throw error;
    const [{ PrerequisiteDeletionConflict }, { SpeakingDeletionConflict }] = await Promise.all([
      import('./help/prerequisite-deletion'),
      import('@/lib/sidedoor/jobs/stitch/speaking-grading-deletion'),
    ]);
    if (error instanceof PrerequisiteDeletionConflict || error instanceof SpeakingDeletionConflict)
      throw new PreparationConflictError('Class media cleanup is not confirmed.');
    throw error;
  }
  return result.operation;
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
): Promise<{
  operation: ClassPreparation;
  settled: boolean;
  cleanupClass?: { id: string; createdAt: number; attempt: number; deleted: boolean };
}> {
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
  if (
    operation.intent?.kind === 'REPAIR' &&
    operation.intent.skills.includes('SPEAKING') &&
    ((await database.classSpeakingStage.findUnique({
      where: { operationId: operation.id },
      select: { sectionId: true },
    })) !== null ||
      (await hasUnsettledSpeakingReferenceWrites(database, operation.courseId)))
  ) {
    const unresolved = await classPreparationStore(database, operation.courseId).transact(
      (current) => {
        if (!current || current.id !== operation.id) throw new PreparationConflictError();
        current.status = 'UNRESOLVED';
        current.updatedAt = Date.now();
        return current;
      }
    );
    return { operation: unresolved, settled: false };
  }
  if (operation.intent) {
    const intent = operation.intent;
    await database.$queryRaw`
      SELECT cls.id FROM "CourseClass" cls
      JOIN "Course" course ON course.id = cls."courseId"
      WHERE cls.id = ${intent.classId} AND course.id = ${operation.courseId}
        AND course."userId" = ${operation.userId}
      FOR UPDATE OF cls
    `;
    const pending =
      intent.retry &&
      (await database.courseClass.findFirst({
        where: {
          id: intent.classId,
          courseId: operation.courseId,
          attempt: intent.attempt,
          status: 'GENERATING',
        },
        select: { id: true, readingVocabulary: true },
      }));
    if (pending && intent.retry) {
      const original = await database.classSection.findFirst({
        where: { id: intent.retry.sectionId, classId: pending.id, skill: { in: intent.skills } },
        select: { id: true },
      });
      if (!original || !['AVAILABLE', 'IN_PROGRESS'].includes(intent.priorStatus))
        throw new PreparationConflictError('The original quiz retry material changed.');
      for (const skill of ['GRAMMAR', 'READING'] as const)
        if (intent.skills.includes(skill)) await requireStageGuard(database, skill);
      // Updates lock a stage before its trigger locks the section. Lock existing
      // stages first, then sections, and recheck under the same snapshot. A stage
      // inserted outside that snapshot is treated as unowned during cleanup.
      if (intent.skills.includes('GRAMMAR'))
        await database.$queryRaw`SELECT g."sectionId" FROM "ClassGrammarStage" g JOIN "ClassSection" s ON s.id = g."sectionId" WHERE s."classId" = ${pending.id} AND s.attempt = ${intent.attempt} ORDER BY g."sectionId" FOR UPDATE OF g`;
      if (intent.skills.includes('READING'))
        await database.$queryRaw`SELECT r."sectionId" FROM "ClassReadingStage" r JOIN "ClassSection" s ON s.id = r."sectionId" WHERE s."classId" = ${pending.id} AND s.attempt = ${intent.attempt} ORDER BY r."sectionId" FOR UPDATE OF r`;
      await database.$queryRaw`SELECT id FROM "ClassSection" WHERE "classId" = ${pending.id} AND attempt = ${intent.attempt} ORDER BY id FOR UPDATE`;
      if (intent.skills.includes('GRAMMAR'))
        await database.$queryRaw`SELECT g."sectionId" FROM "ClassGrammarStage" g JOIN "ClassSection" s ON s.id = g."sectionId" WHERE s."classId" = ${pending.id} AND s.attempt = ${intent.attempt} ORDER BY g."sectionId" FOR UPDATE OF g`;
      if (intent.skills.includes('READING'))
        await database.$queryRaw`SELECT r."sectionId" FROM "ClassReadingStage" r JOIN "ClassSection" s ON s.id = r."sectionId" WHERE s."classId" = ${pending.id} AND s.attempt = ${intent.attempt} ORDER BY r."sectionId" FOR UPDATE OF r`;
      const candidates = await database.classSection.findMany({
        where: {
          classId: pending.id,
          attempt: intent.attempt,
          skill: { in: intent.skills },
        },
        include: { readingStage: true, grammarStage: true },
      });
      const unowned = candidates.some((section) => {
        const stage =
          section.skill === 'READING'
            ? section.readingStage
            : section.skill === 'GRAMMAR'
              ? section.grammarStage
              : null;
        return (
          !section.withdrawn ||
          !stage ||
          stage.operationId !== operation.id ||
          stage.incarnationId !== section.incarnationId ||
          stage.version !== 1
        );
      });
      const legacyVocabularyChanged =
        (!intent.retainedQuiz || !intent.retry.sourceReceipt) &&
        intent.retry.readingVocabulary !== undefined &&
        !isDeepStrictEqual(pending.readingVocabulary, intent.retry.readingVocabulary);
      if (unowned || candidates.length > 1 || legacyVocabularyChanged) {
        const unresolved = await classPreparationStore(database, operation.courseId).transact(
          (current) => {
            if (!current || current.id !== operation.id) throw new PreparationConflictError();
            current.status = 'UNRESOLVED';
            current.updatedAt = Date.now();
            return current;
          }
        );
        return { operation: unresolved, settled: false };
      }
    }
    await database.courseClass.updateMany({
      where: {
        id: operation.intent.classId,
        courseId: operation.courseId,
        attempt: operation.intent.attempt,
        status: 'GENERATING',
      },
      data: intent.retry
        ? {
            status: intent.priorStatus as 'AVAILABLE' | 'IN_PROGRESS',
            progressRevision: { increment: 1 },
          }
        : { status: 'FAILED', failedAt: new Date() },
    });
  }
  let cleanupClass:
    { id: string; createdAt: number; attempt: number; deleted: boolean } | undefined;
  if (!operation.intent && operation.classId && operation.result !== 'created') {
    const unpublished = await database.courseClass.findFirst({
      where: { id: operation.classId, courseId: operation.courseId },
      select: { id: true, createdAt: true, attempt: true, status: true },
    });
    if (unpublished) {
      if (unpublished.status !== 'GENERATING') return { operation, settled: false };
      if (
        await hasUnsettledClassSpeakingReferenceWrites(database, operation.courseId, unpublished.id)
      )
        return { operation, settled: false };
      cleanupClass = {
        id: unpublished.id,
        createdAt: unpublished.createdAt.getTime(),
        attempt: unpublished.attempt,
        deleted: false,
      };
    } else {
      const { readPreparationClassCleanup } = await import('./help/prerequisite-deletion');
      const receipt = await readPreparationClassCleanup(
        database,
        operation.classId,
        operation.userId,
        operation.id
      );
      if (!receipt) {
        if (!(await isEmptyLegacyPreparationCleanup(database, operation)))
          return { operation, settled: false };
      } else cleanupClass = { ...receipt, deleted: true };
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
  return {
    operation: settled,
    settled: !cleanupClass || cleanupClass.deleted,
    ...(cleanupClass ? { cleanupClass } : {}),
  };
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
  const result = await sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      const operation = await classPreparationStore(database, courseId).read();
      if (!operation || actor.userId !== operation.userId || actor.userId !== execution.userId)
        throw new PreparationConflictError('Course not found.');
      await validateClassPreparation(database, courseId, operation.id, true);
      if (!['UNRESOLVED', 'CANCELLING', 'CANCELLED', 'FAILED'].includes(operation.status))
        return operation;
      await classPreparationGrant(database, operation).revoke(operation.grant);
      const recovered = await settlePreparationCleanup(database, operation);
      if (!recovered.settled) return { cleanupBlocked: true as const };
      return recovered.operation;
    },
    { signal: execution.signal }
  );
  if ('cleanupBlocked' in result)
    throw new PreparationConflictError(
      'Execution cleanup is not confirmed. Wait for active work or complete operator recovery.'
    );
  return result;
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
  if (
    !uncertain &&
    !(failed.intent?.kind === 'REPAIR' && failed.intent.skills.includes('SPEAKING'))
  )
    await sottoJobOutbox(database).complete(operation.id, fingerprint);
}
