import { expect, it, vi, type Mock } from 'vitest';
import { checkManualAssessmentOutcome } from './outcome/manual';
import {
  checkWritingAdmission,
  checkWritingAdmissionRollback,
  checkQueuedWritingRollback,
} from './outcome/writing-admission';
import { checkQueuedAssessmentWriting } from './outcome/queued-writing';
import { checkAssessmentWritingRoute } from './outcome/writing-route';
import { checkAssessmentWritingRecovery } from './outcome/writing-recovery';
import { checkAssessmentOutcomeDeletion } from './outcome/deletion';
import { checkAssessmentOutcomeSubmission } from './outcome/submission';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import {
  classAssessmentMaterialSchema,
  createSkillRequirements,
  skillRequirementsSchema,
} from '@sotto/shared';
import { NextRequest } from 'next/server';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { admitAssessmentWork } from '@/lib/learning/classes/generation/assessment-admission';
import { assessmentFenceStateId } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { readAssessmentStatus } from '@/lib/learning/classes/lifecycle/assessment-status';
import { recoverAssessmentOutcome } from '@/lib/learning/classes/lifecycle/assessment-outcome';
import { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';
import type { PrismaClient } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

interface AssessmentOutcomeContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  audioQueue: typeof import('@/lib/queue') | undefined;
  boundary: {
    database: PrismaClient | null;
    execution: SottoProviderExecution | null;
    speakingFixture: boolean;
  };
  provider: { generate: Mock };
}

export function registerAssessmentOutcomeCases(getContext: () => AssessmentOutcomeContext) {
  it.each([
    'manual',
    'worker',
    'queued_worker',
    'writing_route',
    'worker_lost',
    'submission',
    'submission_fail',
    'submission_speaking_fail',
    'submission_speaking_retry',
    'submission_speaking_retry_class',
    'submission_speaking_retry_profile',
    'submission_speaking_profile',
    'submission_speaking_reset',
    'submission_speaking_class',
    'submission_speaking_interrupted',
    'submission_speaking_cancelled',
    'submission_speaking_lock_loss',
    'submission_speaking_failed_cleanup',
    'submission_speaking_failed_profile',
    'submission_speaking_prelaunch_course',
    'submission_speaking_prelaunch_profile',
    'class_deletion',
    'course_deletion',
    'profile_deletion',
  ] as const)(
    'seals reviewed work and recovers delivery after its execution drains (%s)',
    async (selectedMode) => {
      const { instance, identity, classId, audioQueue, boundary, provider } = getContext();
      const mode =
        selectedMode.startsWith('submission_speaking_retry') ||
        selectedMode === 'submission_speaking_profile' ||
        selectedMode === 'submission_speaking_reset' ||
        selectedMode === 'submission_speaking_class' ||
        selectedMode === 'submission_speaking_interrupted' ||
        selectedMode === 'submission_speaking_cancelled' ||
        selectedMode === 'submission_speaking_lock_loss' ||
        selectedMode === 'submission_speaking_failed_cleanup' ||
        selectedMode === 'submission_speaking_failed_profile' ||
        selectedMode === 'submission_speaking_prelaunch_course' ||
        selectedMode === 'submission_speaking_prelaunch_profile'
          ? 'submission_speaking_fail'
          : selectedMode;
      const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
      if (
        mode === 'submission' ||
        mode === 'submission_fail' ||
        mode === 'submission_speaking_fail'
      ) {
        await instance.database.lesson.update({
          where: { id: cls.lessonId },
          data: { targetVocab: [{ lemma: 'чай', gloss: 'tea' }], grammarPoints: ['requests'] },
        });
        await instance.database.learnerVocab.create({
          data: { courseId: cls.courseId, lemma: 'чай', translation: 'tea' },
        });
        await instance.database.learnerGrammar.create({
          data: { courseId: cls.courseId, topicKey: 'requests', title: 'Requests' },
        });
      }
      if (mode === 'submission_speaking_fail') {
        boundary.speakingFixture = true;
        vi.stubEnv('SELF_HOSTED', 'true');
        const requirements = createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'es',
          targetLang: 'ru',
          level: 'A1',
          ttsProvider: null,
          sttProvider: 'openai',
        });
        const speaking = requirements.skills.SPEAKING;
        if (speaking.state !== 'REQUIRED') throw new Error('Speaking is required');
        await instance.database.courseClass.update({
          where: { id: classId },
          data: { skillRequirements: requirements },
        });
        const section = await instance.database.classSection.create({
          data: {
            classId,
            skill: 'SPEAKING',
            attempt: 1,
            status: 'READY',
            seed: 'speaking',
            spec: {},
          },
        });
        for (let index = 0; index < speaking.expectedCount; index += 1) {
          const prompt = await instance.database.speakingPrompt.create({
            data: {
              sectionId: section.id,
              order: index + 1,
              targetPhrase: `Практика ${index}`,
              translation: 'Práctica',
            },
          });
          await instance.database.speakingRecording.create({
            data: {
              sectionId: section.id,
              promptId: prompt.id,
              userId: identity.ownerId,
              audioUrl: '/formative',
              status: 'SCORED',
              overallScore: 0.8,
            },
          });
        }
      }
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
      const deletionMode =
        mode === 'class_deletion' || mode === 'course_deletion' || mode === 'profile_deletion';
      let releaseAdmissionSnapshot: (() => void) | undefined;
      let staleAdmission: Promise<unknown> | undefined;
      let releaseRepairSnapshot: (() => void) | undefined;
      let staleRepair: Promise<unknown> | undefined;
      if (mode === 'manual') {
        const { claimClassRegenerationInTransaction } =
          await import('@/lib/learning/classes/formative/class-generation-state');
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          releaseRepairSnapshot = resolve;
        });
        staleRepair = instance.database
          .$transaction(
            async (tx) => {
              const snapshot = await tx.courseClass.findUniqueOrThrow({ where: { id: classId } });
              started();
              await gate;
              return claimClassRegenerationInTransaction(
                tx,
                execution,
                classId,
                snapshot,
                skillRequirementsSchema.parse(snapshot.skillRequirements)
              );
            },
            { isolationLevel: 'Serializable', timeout: 15000 }
          )
          .then(
            () => null,
            (error: unknown) => error
          );
        await ready;
      }
      if (deletionMode) {
        const { inspectPrerequisiteDeletion } =
          await import('@/lib/classes/help/prerequisite-deletion');
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          releaseAdmissionSnapshot = resolve;
        });
        staleAdmission = instance.database
          .$transaction(
            async (tx) => {
              await tx.courseClass.findUniqueOrThrow({ where: { id: classId } });
              started();
              await gate;
              return inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId);
            },
            { isolationLevel: 'Serializable', timeout: 15000 }
          )
          .then(
            () => null,
            (error: unknown) => error
          );
        await ready;
      }
      const record = await sottoTransaction(instance.database, (tx) =>
        admitAssessmentWork(tx, {
          id: randomUUID(),
          revision: randomUUID(),
          assessmentId: randomUUID(),
          classId,
          classAttempt: cls.attempt,
          assessmentAttempt: 1,
          ...(mode === 'submission_speaking_fail' ? { canonicalSpeaking: true } : {}),
          expiresAt: Date.now() + 120_000,
          selection: {
            provider: 'fixture',
            model: 'fixture',
            credentialFingerprint: null,
            moderationCredentialFingerprint: null,
          },
          execution,
        })
      );
      releaseAdmissionSnapshot?.();
      if (staleAdmission) expect(isSerializationConflict(await staleAdmission)).toBe(true);
      releaseRepairSnapshot?.();
      if (staleRepair) expect(isSerializationConflict(await staleRepair)).toBe(true);
      const operation = { id: record.job.id, fingerprint: record.fingerprint };
      const { fence } = assessmentWorkSchema.parse(record.job.payload);
      if (mode === 'manual') {
        const { claimClassRegenerationInTransaction } =
          await import('@/lib/learning/classes/formative/class-generation-state');
        for (const missing of ['fence', 'row'] as const) {
          await expect(
            sottoTransaction(instance.database, async (tx) => {
              if (missing === 'fence')
                await tx.sidedoorState.delete({ where: { id: assessmentFenceStateId(classId) } });
              else await tx.classAssessment.delete({ where: { id: fence.assessmentId } });
              const snapshot = await tx.courseClass.findUniqueOrThrow({ where: { id: classId } });
              await expect(
                claimClassRegenerationInTransaction(
                  tx,
                  execution,
                  classId,
                  snapshot,
                  fence.requirements
                )
              ).rejects.toThrow('assessment work');
              throw new Error('Rollback isolated assessment state');
            })
          ).rejects.toThrow('Rollback isolated assessment state');
        }
      }
      if (deletionMode) {
        const { inspectPrerequisiteDeletion, PrerequisiteDeletionConflict } =
          await import('@/lib/classes/help/prerequisite-deletion');
        await expect(
          sottoTransaction(instance.database, (tx) =>
            inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
          )
        ).rejects.toBeInstanceOf(PrerequisiteDeletionConflict);
      }
      const scope = fence.ownership.scopes.find((item) => item.subjectId === `class:${classId}`);
      if (!scope) throw new Error('Class scope missing');
      let dispatches = 0;
      provider.generate.mockImplementation(
        async (_system: string, messages: Array<{ content: string }>) => {
          const payload = JSON.parse(messages[0]!.content) as { skill?: string };
          const skill = payload.skill ?? 'REVIEW';
          const questions = (name: string) =>
            Array.from({ length: 5 }, (_, index) => ({
              question: `Independent ${name} ${index}`,
              options: ['a', 'b', 'c', 'd'],
              correctIndex: 1,
              explanation: 'Reason',
            }));
          const content =
            skill === 'GRAMMAR'
              ? { skill, items: questions('grammar') }
              : skill === 'READING'
                ? { skill, passage: 'Новый короткий текст.', items: questions('reading') }
                : skill === 'SPEAKING'
                  ? {
                      skill,
                      items: Array.from({ length: 4 }, (_, index) => ({
                        task: `Новая фраза ${index}`,
                        mode: 'READ_ALOUD',
                        translation: 'Una frase',
                        rubric:
                          'Score recognized word accuracy and completeness. Use word timing for fluency only when available.',
                        guidance: 'Lee la frase.',
                      })),
                    }
                  : skill === 'WRITING'
                    ? {
                        skill,
                        items: Array.from({ length: 3 }, (_, index) => ({
                          task: `Independent writing ${index}`,
                          rubric: 'Criteria',
                          guidance: 'Guidance',
                        })),
                      }
                    : {
                        taught: true,
                        independent: true,
                        correct: true,
                        unambiguous: true,
                        appropriate: true,
                        rubricsSound: true,
                        answersConcealed: true,
                        issues: [],
                      };
          const request = boundary.execution?.providerRequest;
          if (!request) throw new Error('Missing provider journal');
          const response = await request(
            new Request(`https://provider.example.test/${skill}`, { method: 'POST', body: skill }),
            async () => {
              dispatches += 1;
              return Response.json({
                choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
              });
            }
          );
          const data = (await response.json()) as {
            choices: Array<{ message: { content: string } }>;
          };
          return {
            content: data.choices[0]!.message.content,
            model: 'fixture',
            inputTokens: 1,
            outputTokens: 1,
          };
        }
      );
      const root = await mkdtemp(join(tmpdir(), 'sotto-assessment-outcome-'));
      const previousDirectory = process.env.SIDEDOOR_EXECUTION_DIR;
      vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
      try {
        if (
          mode === 'worker' ||
          mode === 'queued_worker' ||
          mode === 'writing_route' ||
          mode === 'worker_lost' ||
          mode === 'submission' ||
          mode === 'submission_fail' ||
          mode === 'submission_speaking_fail' ||
          deletionMode
        ) {
          const { readPublicAssessment } =
            await import('@/lib/learning/classes/material/assessment-read');
          const read = (learnerId: string) =>
            sottoTransaction(instance.database, (tx) =>
              readPublicAssessment(tx, {
                classId,
                assessmentId: fence.assessmentId,
                execution: authorizedLearnerExecution(learnerId),
              })
            );
          await expect(read(identity.ownerId)).rejects.toThrow();
          let admissionAcknowledgmentLost = false;
          if (mode === 'worker_lost') {
            boundary.database = new Proxy(instance.database, {
              get(target, property, receiver) {
                if (property !== '$transaction') return Reflect.get(target, property, receiver);
                return async (...args: Parameters<typeof target.$transaction>) => {
                  const result: unknown = await Reflect.apply(target.$transaction, target, args);
                  if (!admissionAcknowledgmentLost && result === true) {
                    admissionAcknowledgmentLost = true;
                    throw new Error('Lost execution admission acknowledgment');
                  }
                  return result;
                };
              },
            });
          }
          const job = {
            id: operation.id,
            name: 'interactions.v6',
            data: { operationId: operation.id, fingerprint: operation.fingerprint },
          } as import('bullmq').Job<unknown>;
          const { processClassAssessment } =
            await import('@/workers/interactions/class-assessment.worker');
          if (audioQueue) {
            const { Queue } = await import('bullmq');
            const { processInteraction } = await import('@/workers/interaction.worker');
            const { deliverSottoJob } = await import('@/lib/sidedoor/jobs/core/job-delivery');
            const url = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
            const queue = new Queue('interactions', {
              connection: {
                host: url.hostname,
                port: Number(url.port),
                maxRetriesPerRequest: null,
              },
            });
            const worker = audioQueue.createWorker<import('@/lib/queue').ProcessInteractionPayload>(
              'interactions',
              processInteraction,
              { concurrency: 1 }
            );
            let timer: ReturnType<typeof setTimeout> | undefined;
            const completed = new Promise<void>((resolve, reject) => {
              worker.on('completed', (item) => {
                if (item.id === operation.id) resolve();
              });
              worker.on('failed', (item, error) => {
                if (item?.id === operation.id) reject(error);
              });
              timer = setTimeout(
                () => reject(new Error('Assessment worker did not finish')),
                30000
              );
            });
            try {
              await deliverSottoJob({
                database: instance.database,
                queue,
                operationId: operation.id,
                version: 6,
              });
              await completed;
              await (await queue.getJob(operation.id))?.remove();
            } finally {
              if (timer) clearTimeout(timer);
              await worker.close();
              await queue.close();
            }
          } else await processClassAssessment(job);
          expect(
            await instance.database.classAssessment.findUniqueOrThrow({
              where: { id: fence.assessmentId },
            })
          ).toMatchObject({ status: 'READY', sealedAt: expect.any(Date) });
          expect(
            await sottoTransaction(instance.database, (tx) =>
              sottoJobOutbox(tx).receipt(operation.id)
            )
          ).toMatchObject({ status: 'complete', fingerprint: operation.fingerprint });
          const { assessmentArchiveId, readAssessmentArchive } =
            await import('@/lib/learning/classes/history/assessment-archive');
          expect(
            await sottoTransaction(instance.database, (tx) =>
              readAssessmentArchive(tx, operation.id)
            )
          ).toMatchObject({
            fingerprint: operation.fingerprint,
            fence: { id: operation.id, assessmentId: fence.assessmentId, status: 'COMPLETED' },
          });
          await expect(
            sottoTransaction(instance.database, async (tx) => {
              await tx.sidedoorState.delete({ where: { id: assessmentArchiveId(operation.id) } });
              await expect(recoverAssessmentOutcome(tx, operation)).rejects.toThrow();
              throw new Error('Roll back missing assessment archive');
            })
          ).rejects.toThrow('Roll back missing assessment archive');
          await expect(
            sottoTransaction(instance.database, async (tx) => {
              const archive = await tx.sidedoorState.findUniqueOrThrow({
                where: { id: assessmentArchiveId(operation.id) },
              });
              if (
                !archive.state ||
                typeof archive.state !== 'object' ||
                Array.isArray(archive.state)
              )
                throw new Error('Assessment archive missing');
              await tx.sidedoorState.update({
                where: { id: archive.id },
                data: { state: { ...archive.state, fingerprint: '0'.repeat(64) } },
              });
              await expect(recoverAssessmentOutcome(tx, operation)).rejects.toThrow();
              throw new Error('Roll back altered assessment archive');
            })
          ).rejects.toThrow('Roll back altered assessment archive');
          const executionRows = await instance.database.$queryRaw<{ id: string }[]>`
            SELECT id FROM "SidedoorState"
            WHERE (id LIKE 'sd-jeg:1:%' AND id LIKE ${`%:${operation.id}`})
               OR (state->>'kind' = 'job_execution' AND state->>'parentId' = ${operation.id})`;
          expect(executionRows).toHaveLength(2);
          for (const row of executionRows) {
            await expect(
              sottoTransaction(instance.database, async (tx) => {
                await tx.sidedoorState.delete({ where: { id: row.id } });
                await expect(recoverAssessmentOutcome(tx, operation)).rejects.toThrow();
                await expect(readAssessmentStatus(tx, classId, execution)).rejects.toThrow();
                throw new Error('Roll back missing execution fixture');
              })
            ).rejects.toThrow('Roll back missing execution fixture');
          }
          expect(dispatches).toBe(mode === 'submission_speaking_fail' ? 5 : 4);
          await processClassAssessment(job);
          expect(dispatches).toBe(mode === 'submission_speaking_fail' ? 5 : 4);
          if (deletionMode) {
            await checkAssessmentOutcomeDeletion({
              instance,
              identity,
              classId,
              cls,
              fence,
              operation,
              execution,
              mode,
              root,
              assessmentArchiveId,
            });
            return;
          }
          await expect(read(identity.ownerId)).rejects.toThrow('practice before the assessment');
          const assessmentRoute =
            await import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/route');
          const readHttp = (token: string, assessmentId = fence.assessmentId) =>
            assessmentRoute.GET(
              new NextRequest(
                `http://localhost:3000/api/v1/classes/${classId}/assessment/${assessmentId}`,
                {
                  headers: token ? { cookie: `sotto_session=${token}` } : {},
                }
              ),
              { params: Promise.resolve({ classId, assessmentId }) }
            );
          expect((await readHttp(identity.ownerToken)).status).toBe(409);
          expect(
            await sottoTransaction(instance.database, (tx) =>
              readAssessmentStatus(tx, classId, execution)
            )
          ).toEqual({ status: 'PRACTICE_REQUIRED', classAttempt: cls.attempt });
          const formativeQuestions = await instance.database.lessonQuestion.findMany({
            where: { section: { classId } },
          });
          await instance.database.courseClass.update({
            where: { id: classId },
            data: {
              learnerAnswers: Object.fromEntries(formativeQuestions.map((item) => [item.id, 0])),
            },
          });
          await expect(read(identity.ownerId)).rejects.toThrow('writing practice');
          const formativeWriting = await instance.database.writingPrompt.findMany({
            where: { section: { classId } },
          });
          for (const prompt of formativeWriting) {
            await instance.database.writingResponse.create({
              data: {
                promptId: prompt.id,
                sectionId: prompt.sectionId,
                userId: identity.ownerId,
                text: 'Mi respuesta',
                overallScore: 0.1,
                corrections: [],
                feedback: 'Sigue practicando.',
              },
            });
          }
          const visible = await read(identity.ownerId);
          const response = await readHttp(identity.ownerToken);
          expect(response.status).toBe(200);
          expect(response.headers.get('cache-control')).toBe('private, no-store');
          const publicMaterial = classAssessmentMaterialSchema.parse(await response.json());
          expect(publicMaterial).toEqual(visible);
          expect(JSON.stringify(publicMaterial)).not.toMatch(
            /correctIndex|explanation|privateRubric|privateGuidance|privateIdeas|storageRef|audioUrl/
          );
          const { captureAssessmentAudio } =
            await import('@/lib/learning/classes/audio/assessment-audio-read');
          const { captureAssessmentSpeakingTask } =
            await import('@/lib/learning/classes/speaking/assessment-speaking-task');
          await expect(
            sottoTransaction(instance.database, (tx) =>
              captureAssessmentSpeakingTask(tx, {
                classId,
                assessmentId: fence.assessmentId,
                promptId: randomUUID(),
                execution: authorizedLearnerExecution(identity.ownerId),
              })
            )
          ).rejects.toThrow();
          await expect(
            sottoTransaction(instance.database, (tx) =>
              captureAssessmentAudio(tx, {
                classId,
                assessmentId: fence.assessmentId,
                selection: { kind: 'LISTENING', sectionId: publicMaterial.sections[0]!.id },
                execution: authorizedLearnerExecution(identity.ownerId),
              })
            )
          ).rejects.toThrow();
          await expect(
            sottoTransaction(instance.database, (tx) =>
              captureAssessmentAudio(tx, {
                classId,
                assessmentId: fence.assessmentId,
                selection: { kind: 'SPEAKING', promptId: randomUUID() },
                execution: authorizedLearnerExecution(identity.ownerId),
              })
            )
          ).rejects.toThrow();
          const other = await identity.household('Another learner');
          await expect(
            sottoTransaction(instance.database, (tx) =>
              captureAssessmentSpeakingTask(tx, {
                classId,
                assessmentId: fence.assessmentId,
                promptId: randomUUID(),
                execution: authorizedLearnerExecution(other.id),
              })
            )
          ).rejects.toThrow();
          const foreign = await readHttp(other.token);
          const missing = await readHttp(identity.ownerToken, randomUUID());
          expect(foreign.status).toBe(409);
          expect(missing.status).toBe(409);
          expect((await foreign.json()).error).toBe((await missing.json()).error);
          expect((await readHttp('')).status).toBe(401);
          expect(
            await sottoTransaction(instance.database, (tx) =>
              readAssessmentStatus(tx, classId, execution)
            )
          ).toEqual({
            status: 'READY',
            classAttempt: cls.attempt,
            assessmentId: fence.assessmentId,
            revision: expect.stringMatching(/^[a-f0-9]{64}$/),
          });
          const { captureAssessmentForEvaluation } =
            await import('@/lib/learning/classes/material/assessment-read');
          const captured = await sottoTransaction(instance.database, (tx) =>
            captureAssessmentForEvaluation(tx, {
              classId,
              assessmentId: fence.assessmentId,
              execution: authorizedLearnerExecution(identity.ownerId),
            })
          );
          if (
            mode === 'submission' ||
            mode === 'submission_fail' ||
            mode === 'submission_speaking_fail'
          ) {
            await checkAssessmentOutcomeSubmission({
              instance,
              identity,
              classId,
              cls,
              fence,
              operation,
              execution,
              mode,
              selectedMode,
              root,
              provider,
              boundary,
              captured,
              formativeQuestions,
              assessmentRoute,
              other,
              assessmentArchiveId,
            });
            return;
          }
          expect(captured.scope).toMatchObject({
            id: fence.assessmentId,
            classId,
            userId: identity.ownerId,
            reviewedMaterialDigest: captured.scope.review.materialDigest,
          });
          expect(JSON.stringify(captured.material)).toContain('correctIndex');
          const { captureAssessmentWritingTask } =
            await import('@/lib/learning/classes/writing/assessment-writing-read');
          const writingSection = captured.material.sections.find(
            (section) => section.skill === 'WRITING'
          );
          if (!writingSection || writingSection.skill !== 'WRITING')
            throw new Error('Held-out writing material missing');
          const heldOutWriting = writingSection.items[0]!;
          const writingTask = (promptId: string, learnerId = identity.ownerId) =>
            sottoTransaction(instance.database, (tx) =>
              captureAssessmentWritingTask(tx, {
                classId,
                assessmentId: fence.assessmentId,
                promptId,
                execution: authorizedLearnerExecution(learnerId),
              })
            );
          const writingCapture = await writingTask(heldOutWriting.id);
          const writingRoute =
            await import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/writing/[promptId]/route');
          const readWritingHttp = (token: string, promptId = heldOutWriting.id) =>
            writingRoute.GET(
              new NextRequest(
                `http://localhost:3000/api/v1/classes/${classId}/assessment/${fence.assessmentId}/writing/${promptId}`,
                { headers: token ? { cookie: `sotto_session=${token}` } : {} }
              ),
              { params: Promise.resolve({ classId, assessmentId: fence.assessmentId, promptId }) }
            );
          expect(await (await readWritingHttp(identity.ownerToken)).json()).toEqual({
            status: 'NOT_STARTED',
          });
          expect((await readWritingHttp(identity.ownerToken, randomUUID())).status).toBe(409);
          expect((await readWritingHttp(other.token)).status).toBe(409);
          expect((await readWritingHttp('')).status).toBe(401);
          expect(writingCapture).toEqual({
            assessmentId: fence.assessmentId,
            classId,
            courseId: cls.courseId,
            userId: identity.ownerId,
            classAttempt: fence.classAttempt,
            assessmentAttempt: fence.assessmentAttempt,
            materialDigest: captured.scope.reviewedMaterialDigest,
            sectionId: writingSection.id,
            prompt: heldOutWriting,
            requirements: captured.scope.requirements,
          });
          await expect(writingTask(formativeWriting[0]!.id)).rejects.toThrow();
          await expect(writingTask(heldOutWriting.id, other.id)).rejects.toThrow();
          await expect(writingTask(randomUUID())).rejects.toThrow();
          await expect(
            sottoTransaction(instance.database, (tx) =>
              captureAssessmentWritingTask(tx, {
                classId,
                assessmentId: randomUUID(),
                promptId: heldOutWriting.id,
                execution: authorizedLearnerExecution(identity.ownerId),
              })
            )
          ).rejects.toThrow();
          const { admitAssessmentWriting } =
            await import('@/lib/learning/classes/writing/assessment-writing-admission');
          const selection = {
            provider: 'fixture',
            model: 'fixture',
            credentialFingerprint: null,
            moderationCredentialFingerprint: null,
          };
          if (mode === 'writing_route') {
            await checkAssessmentWritingRoute({
              audioQueue,
              provider,
              boundary,
              heldOutWriting,
              writingRoute,
              classId,
              fence,
              other,
              identity,
              writingSection,
              readWritingHttp,
            });
            return;
          }
          if (mode === 'queued_worker') {
            await checkQueuedAssessmentWriting({
              audioQueue,
              instance,
              admitAssessmentWriting,
              fence,
              heldOutWriting,
              writingCapture,
              provider,
              boundary,
              execution,
              readWritingHttp,
              identity,
              root,
              classId,
              cls,
              writingSection,
              writingTask,
              selection,
            });
            return;
          }
          if (mode === 'worker') {
            await checkQueuedWritingRollback({
              instance,
              admitAssessmentWriting,
              fence,
              heldOutWriting,
              writingCapture,
              execution,
              identity,
              classId,
              cls,
              selection,
            });
          }
          await checkWritingAdmissionRollback({
            instance,
            admitAssessmentWriting,
            fence,
            heldOutWriting,
            writingCapture,
            execution,
            identity,
            classId,
            cls,
            selection,
            writingSection,
            captured,
          });
          let committedWriting: { responseId: string; operationId: string } | undefined;
          let writingAdmission: Awaited<ReturnType<typeof admitAssessmentWriting>> | undefined;
          if (mode === 'worker') {
            ({ committedWriting, writingAdmission } = await checkWritingAdmission({
              instance,
              admitAssessmentWriting,
              fence,
              heldOutWriting,
              writingCapture,
              execution,
              identity,
              classId,
              cls,
              selection,
            }));
          }
          const { evaluateAssessmentMaterial } =
            await import('@/lib/learning/classes/material/assessment-material');
          const choices = captured.material.sections.flatMap((section) =>
            section.items.flatMap((item) =>
              'correctIndex' in item ? [{ itemId: item.id, selectedIndex: item.correctIndex }] : []
            )
          );
          expect(
            evaluateAssessmentMaterial(captured.material, captured.scope, choices, [])
          ).toMatchObject({ complete: false, mastered: false });
          expect(() =>
            evaluateAssessmentMaterial(
              captured.material,
              captured.scope,
              [...choices, choices[0]!],
              []
            )
          ).toThrow(/duplicated/);
          await expect(
            sottoTransaction(instance.database, (tx) =>
              captureAssessmentForEvaluation(tx, {
                classId,
                assessmentId: fence.assessmentId,
                execution: authorizedLearnerExecution(randomUUID()),
              })
            )
          ).rejects.toThrow();
          expect(visible.sections.map((section) => section.skill)).toEqual([
            'GRAMMAR',
            'READING',
            'WRITING',
          ]);
          expect(JSON.stringify(visible)).not.toMatch(
            /correctIndex|explanation|privateRubric|privateGuidance|privateIdeas/
          );
          const prompt = formativeWriting[0]!;
          const pending = await instance.database.writingResponse.create({
            data: {
              promptId: prompt.id,
              sectionId: prompt.sectionId,
              userId: identity.ownerId,
              text: 'Otra respuesta',
              createdAt: new Date(Date.now() + 1000),
            },
          });
          await expect(read(identity.ownerId)).rejects.toThrow('writing practice');
          if (committedWriting) {
            expect(await (await readWritingHttp(identity.ownerToken)).json()).toEqual({
              status: 'RUNNING',
              text: 'Пожалуйста, вода.',
            });
            const { readAssessmentWritingRecovery } =
              await import('@/lib/learning/classes/writing/assessment-writing-recovery');
            if (!writingAdmission) throw new Error('Writing admission missing');
            const clock = vi
              .spyOn(Date, 'now')
              .mockReturnValue(writingAdmission.operation.expiresAt + 1);
            try {
              expect(
                await sottoTransaction(instance.database, (tx) =>
                  readAssessmentWritingRecovery(tx, {
                    classId,
                    assessmentId: fence.assessmentId,
                    promptId: heldOutWriting.id,
                    execution,
                  })
                )
              ).toMatchObject({ status: 'UNRESOLVED', text: 'Пожалуйста, вода.' });
            } finally {
              clock.mockRestore();
            }
            expect(
              await sottoTransaction(instance.database, (tx) =>
                readAssessmentWritingRecovery(tx, {
                  classId,
                  assessmentId: fence.assessmentId,
                  promptId: heldOutWriting.id,
                  execution,
                })
              )
            ).toEqual({ ...committedWriting, status: 'RUNNING', text: 'Пожалуйста, вода.' });
            await expect(
              sottoTransaction(instance.database, (tx) =>
                readAssessmentWritingRecovery(tx, {
                  classId,
                  assessmentId: fence.assessmentId,
                  promptId: heldOutWriting.id,
                  execution: authorizedLearnerExecution(other.id),
                })
              )
            ).rejects.toThrow();
          }
          await instance.database.writingResponse.delete({ where: { id: pending.id } });
          if (writingAdmission) {
            await checkAssessmentWritingRecovery({
              provider,
              writingAdmission,
              writingCapture,
              boundary,
              execution,
              instance,
              fence,
              heldOutWriting,
              readWritingHttp,
              identity,
              writingSection,
              captured,
              writingTask,
              admitAssessmentWriting,
              classId,
              selection,
            });
          }
          await expect(read(randomUUID())).rejects.toThrow();
          await instance.database.classSection.updateMany({
            where: { classId, skill: 'GRAMMAR' },
            data: { seed: 'changed after assessment review' },
          });
          await expect(read(identity.ownerId)).rejects.toThrow();
          expect((await readHttp(identity.ownerToken)).status).toBe(409);
          if (mode === 'worker_lost') expect(admissionAcknowledgmentLost).toBe(true);
          boundary.database = instance.database;
          return;
        }
        await checkManualAssessmentOutcome({
          instance,
          identity,
          classId,
          fence,
          operation,
          execution,
          scope,
          getDispatches: () => dispatches,
        });
      } finally {
        boundary.database = instance.database;
        if (previousDirectory === undefined) delete process.env.SIDEDOOR_EXECUTION_DIR;
        else process.env.SIDEDOOR_EXECUTION_DIR = previousDirectory;
        await rm(root, { recursive: true, force: true });
      }
    },
    60000
  );
}
