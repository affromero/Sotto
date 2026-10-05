// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  claimPristineRegeneration,
  readPristineRegenerationSnapshot,
} from '@/lib/classes/regeneration/pristine';
import { regenerateCurrentClass } from '@/lib/class-service';
import {
  claimClassRegeneration,
  settleClassGenerationFailure,
  withClassGeneration,
} from '@/lib/learning/classes/class-generation-state';
import { createSkillRequirements } from '@sotto/shared';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { classPreparationStore } from '@/lib/classes/preparation';
import {
  linkPreparationAudio,
  settlePreparationAudio,
} from '../../helpers/runtime/preparation-audio';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite.each(['AVAILABLE', 'FAILED'] as const)(
  'pristine %s class regeneration admission',
  (status) => {
    let instance: SharedTestInstance;
    let classId: string;
    let sectionId: string;
    let execution: SottoProviderExecution;
    beforeAll(async () => {
      instance = await createSharedTestInstance('pristine_regeneration');
      boundary.database = instance.database;
    });
    beforeEach(async () => {
      const identity = await instance.reset();
      execution = {
        userId: identity.ownerId,
        authorize: async (database) => {
          const owner = await database.user.findUnique({ where: { id: identity.ownerId } });
          if (!owner) throw new Error('Owner unavailable');
          return { userId: owner.id };
        },
      };
      const curriculum = await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
        create: { nativeLang: 'en', targetLang: 'de', title: 'Fixture' },
        update: {},
      });
      const order =
        (await instance.database.lesson.count({ where: { curriculumId: curriculum.id } })) + 1;
      const lesson = await instance.database.lesson.create({
        data: {
          curriculumId: curriculum.id,
          level: 'A2',
          order,
          slug: randomUUID(),
          title: 'Fixture',
          objective: 'Everyday travel',
          grammarPoints: [],
          targetVocab: [],
          vocabThemes: [],
        },
      });
      const course = await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
        },
      });
      const cls = await instance.database.courseClass.create({
        data: {
          courseId: course.id,
          lessonId: lesson.id,
          order: 1,
          status,
          failedAt: status === 'FAILED' ? new Date() : null,
        },
      });
      classId = cls.id;
      sectionId = (
        await instance.database.classSection.create({
          data: {
            classId,
            skill: 'GRAMMAR',
            status: status === 'FAILED' ? 'GENERATING' : 'READY',
            seed: 'fixture',
            spec: {},
          },
        })
      ).id;
      await instance.database.lessonQuestion.create({
        data: {
          sectionId,
          order: 1,
          skill: 'GRAMMAR',
          question: 'Fixture',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Fixture',
        },
      });
    });
    afterAll(async () => {
      if (instance) await instance.close();
    });

    it('recovers failed generation with pending, ready, failed, or absent sections', async () => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      for (const sectionStatus of ['PENDING', 'READY', 'FAILED'] as const) {
        await instance.database.classSection.update({
          where: { id: sectionId },
          data: { status: sectionStatus },
        });
        await expect(readPristineRegenerationSnapshot(classId, execution)).resolves.toMatch(
          /^[a-f0-9]{64}$/
        );
      }
      await instance.database.classSection.deleteMany({ where: { classId } });
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      await claimPristineRegeneration(classId, execution, snapshot);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).toMatchObject({ status: 'GENERATING', attempt: 2, failedAt: null });
    });

    it('claims an unchanged pristine class once and fences a concurrent duplicate', async () => {
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      const results = await Promise.allSettled([
        claimPristineRegeneration(classId, execution, snapshot),
        claimPristineRegeneration(classId, execution, snapshot),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).toMatchObject({ status: 'GENERATING', attempt: 2, failedAt: null });
      expect(await instance.database.classSection.count({ where: { classId } })).toBe(0);
    });

    it.each([
      { learnerAnswers: { savedQuestion: 0 } },
      { writingDrafts: { savedPrompt: 'My unfinished response' } },
      { learnerAnswers: ['invalid'] },
      { writingDrafts: { savedPrompt: 42 } },
    ])('preserves saved or malformed learner work %j', async (data) => {
      await instance.database.courseClass.update({ where: { id: classId }, data });
      await expect(readPristineRegenerationSnapshot(classId, execution)).rejects.toThrow(
        'learner work'
      );
      expect(await instance.database.classSection.count({ where: { classId } })).toBe(1);
    });

    it('allows initialized empty drafts and allocates beyond every historical attempt', async () => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { writingDrafts: { unusedPrompt: '  ' } },
      });
      await instance.database.classSection.update({
        where: { id: sectionId },
        data: { attempt: 7 },
      });
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      const claimed = await claimPristineRegeneration(classId, execution, snapshot);
      expect(claimed.attempt).toBe(8);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).toMatchObject({ status: 'GENERATING', attempt: 8 });
    });

    it('rejects an obsolete producer while a newer attempt is generating', async () => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'GENERATING', attempt: 3 },
      });
      const publish = (attempt: number) =>
        withClassGeneration(execution, classId, attempt, (database) =>
          database.classSection.create({
            data: {
              classId,
              skill: 'WRITING',
              attempt,
              seed: `writing-${attempt}`,
              spec: {},
              status: 'READY',
            },
          })
        );
      await expect(publish(2)).rejects.toThrow('cancelled');
      const current = await publish(3);
      expect(current).toMatchObject({ attempt: 3, status: 'READY' });
      expect(
        await instance.database.classSection.count({ where: { classId, skill: 'WRITING' } })
      ).toBe(1);
    });

    it('claims full regeneration once without removing earlier material or saved work', async () => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { learnerAnswers: { savedQuestion: 2 } },
      });
      await instance.database.classSection.update({
        where: { id: sectionId },
        data: { attempt: 4 },
      });
      const expected = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: classId },
      });
      const requirements = createSkillRequirements({
        scope: 'CLASS',
        nativeLang: 'en',
        targetLang: 'de',
        level: 'A2',
        ttsProvider: null,
        sttProvider: null,
      });
      const results = await Promise.allSettled([
        claimClassRegeneration(execution, classId, expected, requirements),
        claimClassRegeneration(execution, classId, expected, requirements),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toEqual([
        { status: 'fulfilled', value: 5 },
      ]);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).toMatchObject({
        attempt: 5,
        status: 'GENERATING',
        learnerAnswers: { savedQuestion: 2 },
        skillRequirements: requirements,
      });
      expect(await instance.database.lessonQuestion.count({ where: { sectionId } })).toBe(1);
    });

    it('preserves material when regeneration authority was revoked before admission', async () => {
      const expected = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: classId },
      });
      const requirements = createSkillRequirements({
        scope: 'CLASS',
        nativeLang: 'en',
        targetLang: 'de',
        level: 'A2',
        ttsProvider: null,
        sttProvider: null,
      });
      const revoked = {
        ...execution,
        authorize: async () => {
          throw new Error('Learner authority revoked');
        },
      };
      await expect(
        claimClassRegeneration(revoked, classId, expected, requirements)
      ).rejects.toThrow('authority revoked');
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).toMatchObject({ status, attempt: 1 });
      expect(await instance.database.lessonQuestion.count({ where: { sectionId } })).toBe(1);
    });

    it('rolls back returned material when execution aborts during publication', async () => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'GENERATING' },
      });
      const controller = new AbortController();
      await expect(
        withClassGeneration(
          { ...execution, signal: controller.signal },
          classId,
          1,
          async (database) => {
            await database.classSection.create({
              data: { classId, skill: 'WRITING', seed: 'aborted', spec: {}, status: 'READY' },
            });
            controller.abort(new Error('Preparation stopped'));
          }
        )
      ).rejects.toThrow('Preparation stopped');
      expect(
        await instance.database.classSection.count({ where: { classId, skill: 'WRITING' } })
      ).toBe(0);
    });

    it('settles a failed claim after authority expires and preserves newer or published attempts', async () => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'GENERATING', attempt: 3 },
      });
      expect(await settleClassGenerationFailure(classId, 2, execution.userId)).toBe(false);
      expect(await settleClassGenerationFailure(classId, 3, 'different-learner')).toBe(false);
      expect(await settleClassGenerationFailure(classId, 3, execution.userId)).toBe(true);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).toMatchObject({ status: 'FAILED', attempt: 3 });
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'AVAILABLE' },
      });
      expect(await settleClassGenerationFailure(classId, 3, execution.userId)).toBe(false);
      expect(await instance.database.lessonQuestion.count({ where: { sectionId } })).toBe(1);
    });

    it.each(['IN_PROGRESS', 'SUBMITTED', 'PASSED'] as const)(
      'preserves a section with learner interaction state %s',
      async (sectionStatus) => {
        await instance.database.classSection.update({
          where: { id: sectionId },
          data: { status: sectionStatus },
        });
        await expect(readPristineRegenerationSnapshot(classId, execution)).rejects.toThrow(
          'learner work'
        );
        expect(
          await instance.database.classSection.findUnique({ where: { id: sectionId } })
        ).toMatchObject({ status: sectionStatus });
      }
    );

    it.each([{ score: 0 }, { passed: false }])('preserves section assessment %j', async (data) => {
      await instance.database.classSection.update({ where: { id: sectionId }, data });
      await expect(readPristineRegenerationSnapshot(classId, execution)).rejects.toThrow(
        'learner work'
      );
      expect(
        await instance.database.classSection.findUnique({ where: { id: sectionId } })
      ).toMatchObject(data);
    });

    it.each(['submittedAt', 'passedAt'] as const)('rejects a recorded %s', async (field) => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { [field]: new Date() },
      });
      await expect(readPristineRegenerationSnapshot(classId, execution)).rejects.toThrow(
        'learner work'
      );
    });

    it('rejects a class that starts generation after inspection', async () => {
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'GENERATING' },
      });
      await expect(claimPristineRegeneration(classId, execution, snapshot)).rejects.toThrow(
        'Class changed'
      );
      expect(await instance.database.classSection.count({ where: { classId } })).toBe(1);
    });

    it('preserves a submission arriving after the snapshot and rejects before generation', async () => {
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      const submission = await instance.database.classSubmission.create({
        data: {
          classId,
          userId: execution.userId,
          overallScore: 0.8,
          passed: true,
          answers: {
            create: {
              sectionId,
              questionId: 'original-question',
              selectedIndex: 0,
              isCorrect: true,
            },
          },
        },
      });
      await expect(
        regenerateCurrentClass(classId, execution.userId, execution, snapshot)
      ).rejects.toThrow('learner work');
      expect(
        await instance.database.classSubmission.findUnique({
          where: { id: submission.id },
          include: { answers: true },
        })
      ).toMatchObject({ overallScore: 0.8, answers: [{ questionId: 'original-question' }] });
      expect(await instance.database.classSection.count({ where: { classId } })).toBe(1);
    });

    it('rejects changed questions even when the class timestamp did not change', async () => {
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      await instance.database.lessonQuestion.updateMany({
        where: { sectionId },
        data: { explanation: 'Changed after inspection' },
      });
      await expect(claimPristineRegeneration(classId, execution, snapshot)).rejects.toThrow(
        'Class changed'
      );
      expect(await instance.database.lessonQuestion.count({ where: { sectionId } })).toBe(1);
    });

    it('retains learner recordings created after inspection', async () => {
      const speaking = await instance.database.speakingPrompt.create({
        data: { sectionId, order: 1, targetPhrase: 'Fixture', translation: 'Fixture' },
      });
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      const recording = await instance.database.speakingRecording.create({
        data: {
          sectionId,
          promptId: speaking.id,
          userId: execution.userId,
          audioUrl: 'fixture.wav',
          status: 'PENDING',
        },
      });
      await expect(claimPristineRegeneration(classId, execution, snapshot)).rejects.toThrow(
        'learner work'
      );
      expect(
        await instance.database.speakingRecording.findUnique({ where: { id: recording.id } })
      ).not.toBeNull();
    });

    it('retains learner writing created after inspection', async () => {
      const prompt = await instance.database.writingPrompt.create({
        data: { sectionId, order: 1, task: 'Fixture', guidance: 'Fixture', ideas: [] },
      });
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      const response = await instance.database.writingResponse.create({
        data: { sectionId, promptId: prompt.id, userId: execution.userId, text: 'Learner work' },
      });
      await expect(claimPristineRegeneration(classId, execution, snapshot)).rejects.toThrow(
        'learner work'
      );
      expect(
        await instance.database.writingResponse.findUnique({ where: { id: response.id } })
      ).toMatchObject({ text: 'Learner work' });
    });

    it.each([
      { operationStatus: 'CANCELLED' as const, failure: null },
      { operationStatus: 'FAILED' as const, failure: 'generation_failed' as const },
      { operationStatus: 'FAILED' as const, failure: 'source_unreadable' as const },
    ])(
      'keeps $operationStatus audio fenced until its execution cleanup is confirmed',
      async ({ operationStatus, failure }) => {
        const episode = await instance.database.episode.create({
          data: {
            userId: execution.userId,
            title: 'Fixture',
            topic: 'Fixture',
            source: 'CLASS',
            status: 'GENERATING_AUDIO',
          },
        });
        await instance.database.classSection.update({
          where: { id: sectionId },
          data: { episodeId: episode.id },
        });
        const operation = await linkPreparationAudio(
          instance.database,
          execution.userId,
          episode.id
        );
        await instance.database.courseClass.update({
          where: { id: classId },
          data: { courseId: operation.courseId },
        });
        await expect(readPristineRegenerationSnapshot(classId, execution)).rejects.toThrow(
          'active jobs'
        );
        await settlePreparationAudio(instance.database, operation, 'revoked');
        await expect(readPristineRegenerationSnapshot(classId, execution)).rejects.toThrow(
          'active jobs'
        );
        await sottoTransaction(instance.database, (database) =>
          classPreparationStore(database, operation.courseId).transact((current) => {
            if (!current) throw new Error('Missing fixture');
            current.status = operationStatus;
            current.failure = failure;
            current.classId = classId;
          })
        );
        const snapshot = await readPristineRegenerationSnapshot(classId, execution);
        const record = await sottoTransaction(instance.database, async (database) => {
          const captured = await captureEpisodeStorage(database, episode.id);
          return sottoJobOutbox(database).enqueue(
            prepareJob({
              id: randomUUID(),
              namespace: SIDEDOOR_STATE_ID,
              handler: 'audio-generation',
              version: 1,
              payload: {},
              scopes: captured.scopes,
              delivery: { attempts: 1, priority: 0, availableAt: Date.now() },
            })
          );
        });
        await expect(claimPristineRegeneration(classId, execution, snapshot)).rejects.toThrow(
          'active jobs'
        );
        const binding = {
          id: randomUUID(),
          parentId: record.job.id,
          fingerprint: record.fingerprint,
          executorId: randomUUID(),
        };
        await sottoTransaction(instance.database, async (database) => {
          await sottoJobExecutions(database).begin(binding);
          await sottoJobOutbox(database).complete(record.job.id, record.fingerprint);
        });
        await expect(claimPristineRegeneration(classId, execution, snapshot)).rejects.toThrow(
          'active jobs'
        );
        await sottoTransaction(instance.database, (database) =>
          sottoJobExecutions(database).settle(binding)
        );
        await expect(
          claimPristineRegeneration(classId, execution, snapshot)
        ).resolves.toMatchObject({
          id: classId,
        });
      }
    );

    it('rejects failed audio lineage without a known generation or source failure', async () => {
      const episode = await instance.database.episode.create({
        data: {
          userId: execution.userId,
          title: 'Fixture',
          topic: 'Fixture',
          source: 'CLASS',
          status: 'GENERATING_AUDIO',
        },
      });
      await instance.database.classSection.update({
        where: { id: sectionId },
        data: { episodeId: episode.id },
      });
      const operation = await linkPreparationAudio(instance.database, execution.userId, episode.id);
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { courseId: operation.courseId },
      });
      await settlePreparationAudio(instance.database, operation, 'revoked');
      await sottoTransaction(instance.database, (database) =>
        classPreparationStore(database, operation.courseId).transact((current) => {
          if (!current) throw new Error('Missing fixture');
          current.status = 'FAILED';
          current.failure = 'interrupted';
          current.classId = classId;
        })
      );
      await expect(readPristineRegenerationSnapshot(classId, execution)).rejects.toThrow(
        /active jobs/
      );
    });

    it('never erases a recording that wins a concurrent admission', async () => {
      const prompt = await instance.database.speakingPrompt.create({
        data: { sectionId, order: 1, targetPhrase: 'Fixture', translation: 'Fixture' },
      });
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      const [recording, regeneration] = await Promise.allSettled([
        instance.database.speakingRecording.create({
          data: {
            sectionId,
            promptId: prompt.id,
            userId: execution.userId,
            audioUrl: 'fixture.wav',
          },
        }),
        claimPristineRegeneration(classId, execution, snapshot),
      ]);
      if (recording.status === 'fulfilled') {
        expect(regeneration.status).toBe('rejected');
        expect(
          await instance.database.speakingRecording.findUnique({
            where: { id: recording.value.id },
          })
        ).not.toBeNull();
      } else {
        expect(regeneration.status).toBe('fulfilled');
        expect(await instance.database.classSection.count({ where: { classId } })).toBe(0);
      }
    });

    it('rechecks original authority before inspecting or changing the class', async () => {
      const snapshot = await readPristineRegenerationSnapshot(classId, execution);
      const revoked = {
        ...execution,
        authorize: async () => {
          throw new Error('Authority revoked');
        },
      };
      await expect(claimPristineRegeneration(classId, revoked, snapshot)).rejects.toThrow(
        'Authority revoked'
      );
      expect(await instance.database.classSection.count({ where: { classId } })).toBe(1);
    });
  }
);
