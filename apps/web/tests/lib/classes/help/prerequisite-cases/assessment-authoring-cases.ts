import { expect, it, vi, type Mock } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { Prisma } from '@/generated/prisma/client';
import { createSkillRequirements } from '@sotto/shared';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readPrerequisiteSource } from '@/lib/classes/help/content/prerequisite-source';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  withSottoJobExecution,
  runSottoExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { admitAssessmentWork } from '@/lib/learning/classes/generation/assessment-admission';
import { readAssessmentStatus } from '@/lib/learning/classes/lifecycle/assessment-status';
import {
  captureAssessmentSettlementAuthority,
  markExpiredAssessmentUnresolved,
  markAssessmentUnresolved,
} from '@/lib/learning/classes/lifecycle/assessment-unresolved';
import { stageAssessmentSection } from '@/lib/learning/classes/generation/assessment-draft';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { learningPreparationRequestFingerprint } from '@/lib/learning/preparation/preparation-provider';
import { MODERATION_API_URL, moderationRequestBody } from '@/lib/moderation';
import { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import {
  validateAssessmentExecutionState,
  startAssessmentWork,
} from '@/lib/learning/classes/generation/assessment-work';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

interface AssessmentAuthoringContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  questionId: string;
  provider: { generate: Mock };
}

export function registerAssessmentAuthoringCases(getContext: () => AssessmentAuthoringContext) {
  it('does not expose another learner’s class', async () => {
    const { instance, classId } = getContext();
    await expect(
      sottoTransaction(instance.database, (database) =>
        readPrerequisiteSource(database, classId, 'another-user')
      )
    ).rejects.toThrow('unavailable');
  });

  it('accepts an owned saved two-choice question while rejecting invalid choices', async () => {
    const { instance, identity, classId, questionId } = getContext();
    const read = () =>
      sottoTransaction(instance.database, (database) =>
        readPrerequisiteSource(database, classId, identity.ownerId)
      );
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { options: ['Чай, пожалуйста', 'Спасибо'], correctIndex: 0 },
    });
    const captured = await read();
    const grammar = captured.source.sections.find((section) => section.skill === 'GRAMMAR');
    expect(grammar?.questions.find((question) => question.id === questionId)?.options).toEqual([
      'Чай, пожалуйста',
      'Спасибо',
    ]);
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { correctIndex: 3 },
    });
    await expect(read()).rejects.toThrow();
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { options: ['Повтор', 'Повтор'], correctIndex: 0 },
    });
    await expect(read()).rejects.toThrow();
  });

  it('recovers Anthropic input and output moderation from retained database calls', async () => {
    const { instance, identity, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const assessmentId = randomUUID();
    const operationId = randomUUID();
    const inputDigest = 'a'.repeat(64);
    const selection = {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      credentialFingerprint: null,
      moderationCredentialFingerprint: 'b'.repeat(64),
    };
    const fence = {
      id: operationId,
      assessmentId,
      selection,
      cliBinding: null,
    } as import('@/lib/learning/classes/lifecycle/assessment-fence').AssessmentFence;
    const { verifyHistoricalAssessmentModeration } =
      await import('@/lib/learning/classes/review/assessment-review-history');
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        await tx.classAssessment.create({
          data: {
            id: assessmentId,
            classId,
            courseId: cls.courseId,
            userId: identity.ownerId,
            classAttempt: cls.attempt,
            assessmentAttempt: 99,
            requirements: cls.skillRequirements!,
            formativeRevision: 'c'.repeat(64),
          },
        });
        for (const [ordinal, text] of ['lesson', 'verdict'].entries()) {
          const body = Buffer.from(
            JSON.stringify({
              results: [{ categories: {}, category_scores: { violence: ordinal } }],
            })
          );
          const fingerprint = await learningPreparationRequestFingerprint(
            new Request(MODERATION_API_URL, { method: 'POST', body: moderationRequestBody(text) }),
            { selection, operationId, stage: 'REVIEW', inputDigest },
            new AbortController().signal
          );
          await tx.classAssessmentProviderCall.create({
            data: {
              assessmentId,
              stage: 'REVIEW',
              ordinal,
              role: 'MODERATION',
              inputDigest,
              status: 'SUCCEEDED',
              attemptId: randomUUID(),
              attemptFingerprint: fingerprint,
              responseMetadata: { status: 200, statusText: 'OK', headers: [] },
              responseBytes: body,
              responseSha256: createHash('sha256').update(body).digest('hex'),
            },
          });
        }
        await expect(
          verifyHistoricalAssessmentModeration(tx, fence, inputDigest, 'lesson', 'verdict')
        ).resolves.toBeUndefined();
        await expect(
          verifyHistoricalAssessmentModeration(tx, fence, inputDigest, 'lesson', 'changed')
        ).rejects.toThrow();
        throw new Error('Rollback Anthropic moderation fixture');
      })
    ).rejects.toThrow('Rollback Anthropic moderation fixture');
  });

  it.each([
    'tracked',
    'worker',
    'expired',
    'expired_lost',
    'expired_race',
    'terminal',
    'terminal_retry',
    'terminal_yield',
    'terminal_missing',
  ] as const)(
    'retains a stopped failed assessment for recovery without completing its work (%s)',
    async (mode) => {
      const { instance, identity, classId, provider } = getContext();
      const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
      const materialHash = await sottoTransaction(instance.database, (tx) =>
        initialA1MaterialHash(tx, classId, identity.ownerId)
      );
      const receiptId = randomUUID();
      await instance.database.courseClass.update({
        where: { id: classId },
        data: {
          prerequisiteGate: {
            version: 1,
            receiptId,
            classId,
            courseId: cls.courseId,
            userId: identity.ownerId,
            attempt: cls.attempt,
            materialHash,
            acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
          },
        },
      });
      const execution = authorizedLearnerExecution(identity.ownerId);
      const expiresAt = Date.now() + 120_000;
      const record = await sottoTransaction(instance.database, (tx) =>
        admitAssessmentWork(tx, {
          id: randomUUID(),
          revision: randomUUID(),
          assessmentId: randomUUID(),
          classId,
          classAttempt: cls.attempt,
          assessmentAttempt: 1,
          expiresAt,
          selection: {
            provider: 'fixture',
            model: 'fixture',
            credentialFingerprint: null,
            moderationCredentialFingerprint: null,
          },
          execution,
        })
      );
      const operation = { id: record.job.id, fingerprint: record.fingerprint };
      const { fence } = assessmentWorkSchema.parse(record.job.payload);
      const scope = fence.ownership.scopes.find((item) => item.subjectId === `class:${classId}`);
      if (!scope) throw new Error('Assessment class scope missing');
      if (
        mode === 'terminal' ||
        mode === 'terminal_retry' ||
        mode === 'terminal_yield' ||
        mode === 'terminal_missing'
      ) {
        const { Queue, Worker, UnrecoverableError } = await import('bullmq');
        const { observeExecutionGate, reconcileFailedAssessmentDelivery } =
          await import('@/lib/learning/classes/lifecycle/assessment-unresolved');
        expect(
          await sottoTransaction(instance.database, (tx) => observeExecutionGate(tx, operation))
        ).toEqual({ revision: null, blocking: null });
        const redisUrl = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
        const connection = {
          host: redisUrl.hostname,
          port: Number(redisUrl.port),
          maxRetriesPerRequest: null,
        };
        const prefix = `assessment-terminal-${randomUUID()}`;
        const queue = new Queue('interactions', { connection, prefix });
        const worker = new Worker(
          queue.name,
          async () => {
            throw new UnrecoverableError('Synthetic terminal delivery');
          },
          { connection, prefix, autorun: false }
        );
        let restoreRedisCommand = () => {};
        let retriedAfterSnapshot = false;
        try {
          await sottoTransaction(instance.database, (tx) =>
            startAssessmentWork(tx, operation, execution)
          );
          const queued = await queue.add(
            'interactions.v6',
            {
              operationId: operation.id,
              fingerprint: operation.fingerprint,
            },
            {
              jobId: operation.id,
              attempts: record.job.delivery.attempts,
              priority: record.job.delivery.priority,
            }
          );
          const reconcile = () =>
            reconcileFailedAssessmentDelivery({
              database: instance.database,
              queue,
              identity: operation,
              signal: new AbortController().signal,
            });
          if (mode === 'terminal_missing') {
            await expect(reconcile()).rejects.toThrow();
            expect(
              (
                await instance.database.classAssessment.findUniqueOrThrow({
                  where: { id: fence.assessmentId },
                })
              ).status
            ).toBe('GENERATING');
            return;
          }
          void worker.run();
          await expect.poll(() => queued.getState(), { timeout: 10000 }).toBe('failed');
          await worker.close();
          await withSottoJobExecution({
            database: instance.database,
            parentId: operation.id,
            fingerprint: operation.fingerprint,
            signal: new AbortController().signal,
            capabilityScope: scope,
            isCleanupFailure: () => false,
            validate: async () => true,
            run: async () => {
              expect(await reconcile()).toBe('WAITING');
            },
          });
          if (mode === 'terminal_retry' || mode === 'terminal_yield') {
            const client = await queue.getBackend().client;
            const original = client.runCommand.bind(client);
            client.runCommand = async (name, args) => {
              const snapshot = await original(name, args);
              if (name === 'sottoFailedDeliverySnapshotV1') {
                await queued.retry();
                retriedAfterSnapshot = true;
                if (mode === 'terminal_yield')
                  await withSottoJobExecution({
                    database: instance.database,
                    parentId: operation.id,
                    fingerprint: operation.fingerprint,
                    signal: new AbortController().signal,
                    capabilityScope: scope,
                    isCleanupFailure: () => false,
                    validate: async (tx) => {
                      await validateAssessmentExecutionState(tx, operation, execution);
                      return true;
                    },
                    run: async () => {},
                  });
              }
              return snapshot;
            };
            restoreRedisCommand = () => {
              client.runCommand = original;
            };
          }
          if (mode === 'terminal') {
            const { reconcileSottoJobs } =
              await import('@/lib/sidedoor/jobs/core/job-reconciliation');
            const page = await reconcileSottoJobs({
              database: instance.database,
              queues: new Map([[queue.name, queue]]),
              signal: new AbortController().signal,
              cursor: null,
            });
            expect(page.results.find((item) => item.id === operation.id)).toMatchObject({
              status: 'failed',
            });
          } else if (mode === 'terminal_yield') {
            await expect(reconcile()).rejects.toThrow();
            expect(retriedAfterSnapshot).toBe(true);
            expect(
              (
                await instance.database.classAssessment.findUniqueOrThrow({
                  where: { id: fence.assessmentId },
                })
              ).status
            ).toBe('GENERATING');
            expect(
              await sottoTransaction(instance.database, (tx) =>
                learningPreparationGrant(tx, fence, 'assessment').read(fence.grant)
              )
            ).toMatchObject({ status: 'active' });
            return;
          } else expect(await reconcile()).toBe('UNRESOLVED');
          if (mode === 'terminal_retry') {
            expect(retriedAfterSnapshot).toBe(true);
            expect(await queued.getState()).not.toBe('failed');
          } else expect(await reconcile()).toBe('UNRESOLVED');
        } finally {
          restoreRedisCommand();
          await worker.close();
          await queue.obliterate({ force: true });
          await queue.close();
        }
      } else if (mode === 'expired' || mode === 'expired_lost' || mode === 'expired_race') {
        await sottoTransaction(instance.database, (tx) =>
          startAssessmentWork(tx, operation, execution)
        );
        expect(
          await sottoTransaction(instance.database, (tx) =>
            markExpiredAssessmentUnresolved(tx, operation)
          )
        ).toBe(false);
        let releaseStale: (() => void) | undefined;
        let staleResult: Promise<unknown> | undefined;
        if (mode === 'expired_race') {
          let staleReady!: () => void;
          const ready = new Promise<void>((resolve) => {
            staleReady = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            releaseStale = resolve;
          });
          staleResult = instance.database
            .$transaction(
              async (tx) => {
                await tx.classAssessment.findUniqueOrThrow({ where: { id: fence.assessmentId } });
                staleReady();
                await gate;
                return markExpiredAssessmentUnresolved(tx, operation);
              },
              { isolationLevel: 'Serializable', timeout: 30000 }
            )
            .then(
              () => null,
              (error: unknown) => error
            );
          await ready;
          await withSottoJobExecution({
            database: instance.database,
            parentId: operation.id,
            fingerprint: operation.fingerprint,
            signal: new AbortController().signal,
            capabilityScope: scope,
            isCleanupFailure: () => false,
            validate: async (tx) => {
              await validateAssessmentExecutionState(tx, operation, execution);
              return true;
            },
            run: async () => {},
          });
        }
        const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
        try {
          if (staleResult) {
            releaseStale?.();
            expect(isSerializationConflict(await staleResult)).toBe(true);
          }
          await withSottoJobExecution({
            database: instance.database,
            parentId: operation.id,
            fingerprint: operation.fingerprint,
            signal: new AbortController().signal,
            capabilityScope: scope,
            isCleanupFailure: () => false,
            validate: async () => true,
            run: async () => {
              await expect(
                sottoTransaction(instance.database, (tx) =>
                  markExpiredAssessmentUnresolved(tx, operation)
                )
              ).rejects.toThrow();
            },
          });
          if (mode === 'expired_lost') {
            const lostResponse = new Proxy(instance.database, {
              get(target, property, receiver) {
                if (property !== '$transaction') return Reflect.get(target, property, receiver);
                return async (...args: Parameters<typeof target.$transaction>) => {
                  const result: unknown = await Reflect.apply(target.$transaction, target, args);
                  if (result === true) throw new Error('Lost expiry commit acknowledgment');
                  return result;
                };
              },
            });
            await expect(
              sottoTransaction(lostResponse, (tx) => markExpiredAssessmentUnresolved(tx, operation))
            ).rejects.toThrow('Lost expiry commit acknowledgment');
          }
          const { processClassAssessment } =
            await import('@/workers/interactions/class-assessment.worker');
          const job = {
            id: operation.id,
            name: 'interactions.v6',
            data: { operationId: operation.id, fingerprint: operation.fingerprint },
          } as import('bullmq').Job<unknown>;
          await expect(processClassAssessment(job)).rejects.toThrow();
          expect(
            await sottoTransaction(instance.database, (tx) =>
              markExpiredAssessmentUnresolved(tx, operation)
            )
          ).toBe(true);
          await expect(
            sottoTransaction(instance.database, (tx) =>
              markExpiredAssessmentUnresolved(tx, { ...operation, fingerprint: '0'.repeat(64) })
            )
          ).rejects.toThrow();
          expect(provider.generate).not.toHaveBeenCalled();
        } finally {
          releaseStale?.();
          clock.mockRestore();
        }
      } else if (mode === 'worker') {
        provider.generate.mockRejectedValue(new Error('Assessment authoring failed'));
        const { processClassAssessment } =
          await import('@/workers/interactions/class-assessment.worker');
        const job = {
          id: operation.id,
          name: 'interactions.v6',
          data: { operationId: operation.id, fingerprint: operation.fingerprint },
        } as import('bullmq').Job<unknown>;
        await expect(processClassAssessment(job)).rejects.toThrow();
        const calls = provider.generate.mock.calls.length;
        await expect(processClassAssessment(job)).rejects.toThrow();
        expect(provider.generate.mock.calls.length).toBe(calls);
      } else {
        let authority: object | undefined;
        await expect(
          withSottoJobExecution({
            database: instance.database,
            parentId: operation.id,
            fingerprint: operation.fingerprint,
            signal: new AbortController().signal,
            capabilityScope: scope,
            isCleanupFailure: () => false,
            validate: async () => true,
            run: async ({ capability }) => {
              if (!capability) throw new Error('Assessment execution capability missing');
              await sottoTransaction(instance.database, (tx) =>
                startAssessmentWork(tx, operation, execution)
              );
              authority = await captureAssessmentSettlementAuthority({
                identity: operation,
                capability,
              });
              await runSottoExecutionOperation(
                capability,
                { parentId: operation.id, fingerprint: operation.fingerprint },
                async () => {
                  throw new Error('Assessment authoring failed');
                }
              );
            },
          })
        ).rejects.toThrow('Assessment authoring failed');
        if (!authority) throw new Error('Assessment settlement authority missing');
        expect(await markAssessmentUnresolved({ database: instance.database, authority })).toEqual({
          status: 'UNRESOLVED',
        });
      }
      expect(
        await instance.database.classAssessment.findUniqueOrThrow({
          where: { id: fence.assessmentId },
        })
      ).toMatchObject({ status: 'UNRESOLVED', sealedAt: null });
      expect(
        await sottoTransaction(instance.database, (tx) =>
          learningPreparationGrant(tx, fence, 'assessment').read(fence.grant)
        )
      ).toMatchObject({ status: 'revoked' });
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(operation.id))
      ).toMatchObject({ status: 'pending', fingerprint: operation.fingerprint });
      expect(
        await sottoTransaction(instance.database, (tx) =>
          readAssessmentStatus(tx, classId, execution)
        )
      ).toEqual({ status: 'UNRESOLVED', classAttempt: cls.attempt });
    }
  );

  it.each(['READ_ALOUD', 'COMMUNICATIVE'] as const)(
    'admits a supported speaking assessment or rejects unsupported practice before paid work (%s)',
    async (mode) => {
      const { instance, identity, classId } = getContext();
      const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
      const requirements = createSkillRequirements({
        scope: 'CLASS',
        nativeLang: 'es',
        targetLang: 'ru',
        level: 'A1',
        ttsProvider: null,
        sttProvider: 'configured',
      });
      const required = requirements.skills.SPEAKING;
      if (required.state !== 'REQUIRED') throw new Error('Speaking is required');
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { skillRequirements: requirements },
      });
      const section = await instance.database.classSection.create({
        data: { classId, skill: 'SPEAKING', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
      });
      const { privateSpeakingFixture } =
        await import('../../../../lib/learning-map/private-speaking/fixtures');
      const communicative = privateSpeakingFixture(identity.ownerId, cls.courseId).assessment;
      await instance.database.speakingPrompt.createMany({
        data: Array.from({ length: required.expectedCount }, (_, index) => ({
          sectionId: section.id,
          order: index + 1,
          targetPhrase: `Привет ${index}`,
          translation: 'Hola',
          ...(mode === 'COMMUNICATIVE' && index === 0
            ? { learningObjectives: communicative as unknown as Prisma.InputJsonValue }
            : {}),
        })),
      });
      const materialHash = await sottoTransaction(instance.database, (tx) =>
        initialA1MaterialHash(tx, classId, identity.ownerId)
      );
      const receiptId = randomUUID();
      await instance.database.courseClass.update({
        where: { id: classId },
        data: {
          prerequisiteGate: {
            version: 1,
            receiptId,
            classId,
            courseId: cls.courseId,
            userId: identity.ownerId,
            attempt: cls.attempt,
            materialHash,
            acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
          },
        },
      });
      const admit = () =>
        sottoTransaction(instance.database, (tx) =>
          admitAssessmentWork(tx, {
            id: randomUUID(),
            revision: randomUUID(),
            assessmentId: randomUUID(),
            classId,
            classAttempt: cls.attempt,
            assessmentAttempt: 1,
            expiresAt: Date.now() + 120_000,
            canonicalSpeaking: true,
            selection: {
              provider: 'fixture',
              model: 'fixture',
              credentialFingerprint: null,
              moderationCredentialFingerprint: null,
            },
            execution: authorizedLearnerExecution(identity.ownerId),
          })
        );
      if (mode === 'COMMUNICATIVE') {
        await expect(admit()).rejects.toThrow('cannot yet be graded');
        expect(await instance.database.classAssessment.count({ where: { classId } })).toBe(0);
        expect(
          await instance.database.sidedoorState.count({
            where: { id: { startsWith: `${SIDEDOOR_STATE_ID}:assessment-grant:` } },
          })
        ).toBe(0);
        return;
      }
      const admitted = await admit();
      expect(assessmentWorkSchema.parse(admitted.job.payload).fence.speakingPolicy).toBe(
        'READ_ALOUD_TRANSCRIPT_V1'
      );
      const operation = { id: admitted.job.id, fingerprint: admitted.fingerprint };
      const execution = authorizedLearnerExecution(identity.ownerId);
      await sottoTransaction(instance.database, (tx) =>
        startAssessmentWork(tx, operation, execution)
      );
      const { READ_ALOUD_ASSESSMENT_RUBRIC } =
        await import('@/lib/learning/classes/speaking/assessment-speaking-policy');
      const items = Array.from({ length: required.expectedCount }, (_, index) => ({
        task: `Добрый день ${index}`,
        mode: 'READ_ALOUD',
        translation: 'Buenos días',
        rubric: READ_ALOUD_ASSESSMENT_RUBRIC,
        guidance: 'Lee la frase.',
      }));
      await expect(
        sottoTransaction(instance.database, (tx) =>
          stageAssessmentSection(tx, operation, execution, {
            skill: 'SPEAKING',
            items: items.map((item) => ({ ...item, rubric: 'Score accent.' })),
          })
        )
      ).rejects.toThrow();
      expect(
        await instance.database.speakingPrompt.count({
          where: {
            assessmentSection: {
              assessmentId: assessmentWorkSchema.parse(admitted.job.payload).fence.assessmentId,
            },
          },
        })
      ).toBe(0);
      await sottoTransaction(instance.database, (tx) =>
        stageAssessmentSection(tx, operation, execution, { skill: 'SPEAKING', items })
      );
      expect(
        await instance.database.speakingPrompt.count({
          where: {
            assessmentSection: {
              assessmentId: assessmentWorkSchema.parse(admitted.job.payload).fence.assessmentId,
            },
          },
        })
      ).toBe(required.expectedCount);
    }
  );
}
