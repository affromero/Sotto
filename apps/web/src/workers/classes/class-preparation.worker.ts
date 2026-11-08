import type { Job } from 'bullmq';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createNextClass, regenerateCurrentClass } from '@/lib/class-service';
import { ClassSourceError } from '@/lib/class-source';
import { logger } from '@/lib/logger';
import { generationDiagnostic } from '@/lib/classes/quality/failure/diagnostic';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  CLASS_PREPARATION_QUEUE,
  classPreparationPayload,
  classPreparationStore,
  validateClassPreparation,
  recordClassPreparationFailure,
  settleCancelledPreparation,
} from '@/lib/classes/preparation';
import {
  classPreparationInitialA1,
  PreparationConflictError,
  startPreparation,
} from '@/lib/classes/preparation-state';
import { classPreparationGrant } from '@/lib/classes/preparation-grant';
import { preparationProviderRequest } from '@/lib/classes/preparation-provider';
import { registerPreparationAudio } from '@/lib/classes/preparation-audio';
import {
  assertClassGeneration,
  publishClassGeneration,
} from '@/lib/learning/classes/formative/class-generation-state';
import {
  requireRepairQuizFence,
  retainedQuizReceipt,
} from '@/lib/learning/classes/formative/class-repair';
import { currentClassSections } from '@/lib/learning/classes/progress/current-sections';
import { activateStagedReading, stageClassReading } from '@/lib/classes/staging/staged-reading';
import { activateStagedWriting, stageClassWriting } from '@/lib/classes/staging/staged-writing';
import {
  activateStagedSpeaking,
  sealClassSpeaking,
  stageClassSpeaking,
  verifySpeakingReferenceStage,
} from '@/lib/classes/staging/staged-speaking';
import { activateStagedGrammar, stageClassGrammar } from '@/lib/classes/staging/staged-grammar';
import { readSkillRequirements } from '@/lib/learning/skill-requirements';
import {
  captureGenerationFailure,
  generationCleanupUnconfirmed,
} from '@/lib/classes/quality/generation-failure';

/** A crashed generation is fenced as unresolved; replay never repeats unproven external work. */
export async function processClassPreparation(job: Job<unknown>, workerSignal?: AbortSignal) {
  const work = await sottoTransaction(prisma, (database) =>
    readSottoWorkerJob(database, job, {
      handler: CLASS_PREPARATION_QUEUE,
      version: 1,
      payload: classPreparationPayload,
    })
  );
  if (work.complete) return;
  const { courseId, operationId } = work.payload;
  if (operationId !== work.operationId)
    throw new PreparationConflictError('Preparation identity changed.');
  const controller = new AbortController();
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, controller.signal])
    : controller.signal;
  let outcomeUnknown = false;
  await withSottoJobExecution({
    database: prisma,
    parentId: work.operationId,
    fingerprint: work.fingerprint,
    signal,
    isCleanupFailure: (error) =>
      outcomeUnknown || generationCleanupUnconfirmed(error) || isDurableQueueCleanupFailure(error),
    validate: async (database) => {
      const current = await readSottoWorkerJob(database, job, {
        handler: CLASS_PREPARATION_QUEUE,
        version: 1,
        payload: classPreparationPayload,
      });
      if (current.complete) return false;
      await validateClassPreparation(database, courseId, operationId, true);
      return true;
    },
    run: async ({ markCleanupUnconfirmed, directory }) => {
      const operation = await sottoTransaction(prisma, async (database) => {
        await validateClassPreparation(database, courseId, operationId, true);
        return classPreparationStore(database, courseId).transact((current) => {
          if (!current || current.id !== operationId) throw new PreparationConflictError();
          Object.assign(current, startPreparation(current, Date.now()));
          return current;
        });
      });
      if (operation.status !== 'RUNNING') {
        await sottoTransaction(prisma, async (database) => {
          if (operation.status !== 'COMPLETED')
            await classPreparationGrant(database, operation).revoke(operation.grant);
          if (
            operation.status === 'COMPLETED' ||
            operation.intent?.kind !== 'REPAIR' ||
            !operation.intent.skills.includes('SPEAKING')
          )
            await sottoJobOutbox(database).complete(operationId, work.fingerprint);
        });
        return;
      }
      let checking = false;
      const check = async () => {
        if (checking || signal.aborted) return;
        checking = true;
        try {
          await sottoTransaction(prisma, (database) =>
            validateClassPreparation(database, courseId, operationId)
          );
        } catch (error) {
          controller.abort(error);
        } finally {
          checking = false;
        }
      };
      const timer = setInterval(() => {
        void check();
      }, 500);
      const authorize = async (database: Parameters<typeof validateClassPreparation>[0]) => {
        signal.throwIfAborted();
        const current = await validateClassPreparation(database, courseId, operationId);
        if (!isDeepStrictEqual(current.intent, operation.intent))
          throw new PreparationConflictError('The admitted class repair changed.');
        return { userId: current.userId };
      };
      const verifyTeachingPolicy = async (
        database: Prisma.TransactionClient,
        classId: string,
        requireProof: boolean,
        repair: boolean
      ) => {
        const current = await validateClassPreparation(database, courseId, operationId);
        if (
          current.initialA1Class !== operation.initialA1Class ||
          !isDeepStrictEqual(current.requirements, operation.requirements) ||
          !isDeepStrictEqual(current.intent, operation.intent)
        )
          throw new PreparationConflictError('The admitted class teaching policy changed.');
        const cls = await database.courseClass.findFirst({
          where: { id: classId, courseId, course: { userId: operation.userId } },
          select: { skillRequirements: true },
        });
        const requirements = cls && readSkillRequirements(cls.skillRequirements);
        if (
          !requirements ||
          (current.requirements && !isDeepStrictEqual(requirements, current.requirements)) ||
          requireProof !==
            (!repair && requirements.level === 'A1' && (current.initialA1Class ?? true))
        )
          throw new PreparationConflictError('The admitted class teaching policy changed.');
      };
      try {
        if (operation.intent) {
          const target = operation.intent;
          if (target.kind === 'REPAIR' && !target.retainedQuiz)
            throw new PreparationConflictError('This repair must be admitted again.');
          if (
            target.kind === 'REPAIR' &&
            target.skills.includes('GRAMMAR') &&
            !target.grammarSourceHash
          )
            throw new PreparationConflictError('This grammar repair must be admitted again.');
          if (
            target.kind === 'REPAIR' &&
            target.skills.includes('WRITING') &&
            !target.writingSourceHash
          )
            throw new PreparationConflictError('This writing repair must be admitted again.');
          if (
            target.kind === 'REPAIR' &&
            target.skills.includes('SPEAKING') &&
            !target.speakingSourceHash
          )
            throw new PreparationConflictError('This speaking repair must be admitted again.');
          const retrySkill =
            target.retry && target.skills.length === 1 ? target.skills[0] : undefined;
          if (
            target.retry &&
            (target.kind !== 'REPAIR' ||
              (retrySkill !== 'GRAMMAR' && retrySkill !== 'READING' && retrySkill !== 'LISTENING'))
          )
            throw new PreparationConflictError('The admitted quiz retry target changed.');
          await regenerateCurrentClass(
            target.classId,
            operation.userId,
            {
              userId: operation.userId,
              authorize,
              signal,
              onCleanupError: markCleanupUnconfirmed,
              learningSelection: operation.selection,
              initialA1Class: classPreparationInitialA1(operation),
              isolatedWorkspace: { directory, markCleanupUnconfirmed },
              registerAudioEpisode: (database, episodeId, key) =>
                registerPreparationAudio(database, operation, episodeId, key),
              stageClassReading: (database, input) => stageClassReading(database, operation, input),
              stageClassWriting: (database, input) => stageClassWriting(database, operation, input),
              writingRepairSourceHash: target.writingSourceHash,
              speakingRepairSourceHash: target.speakingSourceHash,
              stageClassSpeaking: (database, input) =>
                stageClassSpeaking(database, operation, input),
              verifySpeakingReferenceStage: (database, input) =>
                verifySpeakingReferenceStage(database, operation, input),
              sealClassSpeaking: (database, input) => sealClassSpeaking(database, operation, input),
              stageClassGrammar: (database, input) => stageClassGrammar(database, operation, input),
              grammarRepairSourceHash: target.grammarSourceHash,
              providerRequest: preparationProviderRequest(operation, signal, () => {
                outcomeUnknown = true;
                markCleanupUnconfirmed();
                controller.abort(
                  new PreparationConflictError('The provider outcome is unresolved.')
                );
              }),
            },
            undefined,
            {
              repair: target.kind === 'REPAIR',
              skills: target.skills,
              retry: target.retry?.context,
              ...(target.retry && retrySkill
                ? { retrySection: { sectionId: target.retry.sectionId, skill: retrySkill } }
                : {}),
              attempt: target.attempt,
              requirements: operation.requirements,
              deferAudio: operation.deferAudio,
              publish: (adaptiveSeed, source, requireTeachingProof) =>
                sottoTransaction(
                  prisma,
                  async (database) => {
                    await authorize(database);
                    await verifyTeachingPolicy(
                      database,
                      target.classId,
                      requireTeachingProof,
                      target.kind === 'REPAIR'
                    );
                    let retainedQuizSectionIds: string[] | undefined;
                    if (target.kind === 'REPAIR' && target.retainedQuiz) {
                      await assertClassGeneration(
                        database,
                        target.classId,
                        target.attempt,
                        operation.userId
                      );
                      await requireRepairQuizFence(database);
                      const retained = await database.courseClass.findUniqueOrThrow({
                        where: { id: target.classId },
                        include: {
                          course: true,
                          lesson: true,
                          sections: {
                            include: {
                              questions: true,
                              prompts: true,
                              writingPrompts: true,
                              episode: { include: { script: true } },
                            },
                          },
                        },
                      });
                      if (
                        !isDeepStrictEqual(
                          retainedQuizReceipt(retained, target.skills),
                          target.retainedQuiz
                        )
                      )
                        throw new PreparationConflictError(
                          'The retained quiz material changed during repair.'
                        );
                      if (target.skills.includes('GRAMMAR'))
                        await activateStagedGrammar(database, operation);
                      if (target.skills.includes('READING'))
                        await activateStagedReading(database, operation);
                      if (target.skills.includes('WRITING'))
                        await activateStagedWriting(database, operation);
                      if (target.skills.includes('SPEAKING'))
                        await activateStagedSpeaking(database, operation);
                      const sections = await database.classSection.findMany({
                        where: { classId: target.classId },
                      });
                      const current = currentClassSections(sections);
                      for (const skill of target.skills) {
                        const sections = current.filter((section) => section.skill === skill);
                        if (sections.length !== 1 || sections[0]!.attempt !== target.attempt)
                          throw new PreparationConflictError(
                            'The repaired section changed during repair.'
                          );
                      }
                      retainedQuizSectionIds = target.retainedQuiz.sections.map(
                        (section) => section.sectionId
                      );
                    }
                    await publishClassGeneration(database, {
                      classId: target.classId,
                      attempt: target.attempt,
                      userId: operation.userId,
                      requireInitialA1TeachingProof: requireTeachingProof,
                      requireInitialA1SectionProof: requireTeachingProof,
                      requireInitialA1WritingProof: requireTeachingProof,
                      requireInitialA1SpeakingProof: requireTeachingProof,
                      requireInitialA1ListeningProof: requireTeachingProof,
                      status: target.kind === 'REPAIR' ? 'IN_PROGRESS' : 'AVAILABLE',
                      ...(retainedQuizSectionIds ? { retainedQuizSectionIds } : {}),
                      data: { adaptiveSeed, ...source },
                    });
                    await classPreparationGrant(database, operation).complete(operation.grant);
                    await classPreparationStore(database, courseId).transact((current) => {
                      if (!current || current.id !== operationId)
                        throw new PreparationConflictError();
                      Object.assign(current, {
                        status: 'COMPLETED',
                        result: 'created',
                        updatedAt: Date.now(),
                      });
                    });
                    await sottoJobOutbox(database).complete(operationId, work.fingerprint);
                  },
                  { signal }
                ),
            }
          );
          return;
        }
        const result = await createNextClass(
          courseId,
          operation.userId,
          {
            userId: operation.userId,
            authorize,
            signal,
            onCleanupError: markCleanupUnconfirmed,
            learningSelection: operation.selection,
            initialA1Class: classPreparationInitialA1(operation),
            isolatedWorkspace: { directory, markCleanupUnconfirmed },
            registerAudioEpisode: (database, episodeId, audioGenerationKey) =>
              registerPreparationAudio(database, operation, episodeId, audioGenerationKey),
            providerRequest: preparationProviderRequest(operation, signal, () => {
              outcomeUnknown = true;
              markCleanupUnconfirmed();
              controller.abort(new PreparationConflictError('The provider outcome is unresolved.'));
            }),
          },
          { sourceUrl: work.payload.sourceUrl, topic: work.payload.topic },
          {
            deferAudio: operation.deferAudio,
            requirements: operation.requirements,
            create: (data) =>
              sottoTransaction(
                prisma,
                async (database) => {
                  await authorize(database);
                  const cls = await database.courseClass.create({
                    data: { ...data, id: operationId },
                  });
                  await classPreparationStore(database, courseId).transact((current) => {
                    if (!current || current.id !== operationId)
                      throw new PreparationConflictError();
                    current.classId = cls.id;
                    current.updatedAt = Date.now();
                  });
                  return cls;
                },
                { signal }
              ),
            publish: (classId, adaptiveSeed, requireTeachingProof) =>
              sottoTransaction(
                prisma,
                async (database) => {
                  await authorize(database);
                  await verifyTeachingPolicy(database, classId, requireTeachingProof, false);
                  await publishClassGeneration(database, {
                    classId,
                    attempt: 1,
                    userId: operation.userId,
                    requireInitialA1TeachingProof: requireTeachingProof,
                    requireInitialA1SectionProof: requireTeachingProof,
                    requireInitialA1WritingProof: requireTeachingProof,
                    requireInitialA1SpeakingProof: requireTeachingProof,
                    requireInitialA1ListeningProof: requireTeachingProof,
                    data: { adaptiveSeed },
                  });
                  await classPreparationGrant(database, operation).complete(operation.grant);
                  await classPreparationStore(database, courseId).transact((current) => {
                    if (!current || current.id !== operationId)
                      throw new PreparationConflictError();
                    Object.assign(current, {
                      status: 'COMPLETED',
                      result: 'created',
                      updatedAt: Date.now(),
                    });
                  });
                  await sottoJobOutbox(database).complete(operationId, work.fingerprint);
                },
                { signal }
              ),
          }
        );
        if (result.kind !== 'created') {
          await sottoTransaction(prisma, async (database) => {
            await authorize(database);
            await classPreparationGrant(database, operation).complete(operation.grant);
            await classPreparationStore(database, courseId).transact((current) => {
              if (!current || current.id !== operationId) throw new PreparationConflictError();
              Object.assign(current, {
                status: 'COMPLETED',
                result: result.kind,
                classId: result.kind === 'gated' ? result.activeClassId : null,
                updatedAt: Date.now(),
              });
            });
            await sottoJobOutbox(database).complete(operationId, work.fingerprint);
          });
        }
      } catch (error) {
        const uncertain =
          outcomeUnknown ||
          generationCleanupUnconfirmed(error) ||
          isDurableQueueCleanupFailure(error) ||
          workerSignal?.aborted;
        if (isDurableQueueCleanupFailure(error)) markCleanupUnconfirmed();
        const failure = captureGenerationFailure(error);
        logger.error('Class preparation failed', {
          operationId,
          courseId,
          uncertain: Boolean(uncertain),
          category: failure.category,
          ...generationDiagnostic(error),
        });
        await sottoTransaction(prisma, (database) =>
          recordClassPreparationFailure(
            database,
            operation,
            work.fingerprint,
            Boolean(uncertain),
            error instanceof ClassSourceError ? 'source_unreadable' : 'generation_failed',
            failure
          )
        );
        if (uncertain) throw error;
      } finally {
        clearInterval(timer);
        controller.abort();
      }
    },
  });
  await sottoTransaction(prisma, async (database) => {
    const current = await classPreparationStore(database, courseId).read();
    if (
      current?.id === operationId &&
      current.intent &&
      (['FAILED', 'CANCELLING', 'CANCELLED'].includes(current.status) ||
        (current.status === 'UNRESOLVED' &&
          (current.failure === 'generation_failed' || current.failure === 'source_unreadable')))
    )
      await settleCancelledPreparation(database, current);
  });
}
