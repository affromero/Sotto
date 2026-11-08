import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import type { Prisma } from '@/generated/prisma/client';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import type { AssessmentSchemaContext } from './schema-context';

export function registerSchemaSourceCases(getContext: () => AssessmentSchemaContext) {
  it('fences source writers whose snapshots predate an attached and frozen class', async () => {
    const { instance, ownerId, courseId, classId, assessment } = getContext();
    const existing = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: classId },
      select: { lessonId: true },
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let count = 0;
    const staleWriter = (write: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      instance.database
        .$transaction(
          async (tx) => {
            await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { id: true } });
            if (++count === 2) started();
            await gate;
            await write(tx);
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
    const stale = [
      staleWriter((tx) =>
        tx.course.update({ where: { id: courseId }, data: { nativeLang: 'en' } })
      ),
      staleWriter((tx) =>
        tx.lesson.update({ where: { id: existing.lessonId }, data: { title: 'Changed' } })
      ),
    ];
    await ready;
    try {
      const cls = await instance.database.courseClass.create({
        data: { courseId, lessonId: existing.lessonId, order: 2, status: 'IN_PROGRESS' },
      });
      const operationId = randomUUID();
      const saved = await instance.database.classAssessment.create({
        data: { ...assessment(1, 1), classId: cls.id, generationOperationId: operationId },
      });
      const section = await instance.database.classAssessmentSection.create({
        data: { assessmentId: saved.id, skill: 'LISTENING', passThreshold: 0.7 },
      });
      await instance.database.$transaction(async (tx) => {
        const episode = await tx.episode.create({
          data: {
            userId: ownerId,
            title: 'Audio',
            topic: 'Assessment',
            assessmentAudioAssessmentId: saved.id,
            assessmentAudioSectionId: section.id,
            assessmentAudioOperationId: operationId,
          },
        });
        await tx.classAssessmentSection.update({
          where: { id: section.id },
          data: {
            episodeId: episode.id,
            audioReservationEpisodeId: episode.id,
            audioReservationOperationId: operationId,
          },
        });
        await tx.episode.update({
          where: { id: episode.id },
          data: { audioGenerationKey: randomUUID() },
        });
      });
    } finally {
      release();
    }
    for (const error of await Promise.all(stale)) expect(isSerializationConflict(error)).toBe(true);
  }, 30000);

  it.each(['class-first', 'episode-first', 'course-first'] as const)(
    'keeps admitted audio and its held-out material together until the whole assessment is deleted (%s)',
    async (order) => {
      const { instance, ownerId, courseId, classId, assessment } = getContext();
      const operationId = randomUUID();
      const classDetails = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: classId },
        select: { lessonId: true },
      });
      const formative = await instance.database.classSection.create({
        data: { classId, skill: 'GRAMMAR', seed: 'fixture', status: 'READY', spec: {} },
      });
      await expect(
        instance.database.speakingPrompt.create({
          data: {
            sectionId: formative.id,
            order: 0,
            targetPhrase: 'Hello',
            translation: 'Hola',
            assessmentCriteria: [{ id: 'meaning', description: 'Meaning', modality: 'TRANSCRIPT' }],
          },
        })
      ).rejects.toThrow();
      const formativeQuestion = await instance.database.lessonQuestion.create({
        data: {
          sectionId: formative.id,
          order: 0,
          skill: 'GRAMMAR',
          question: 'Choose a greeting',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'A greeting',
        },
      });
      const speechSection = await instance.database.classSection.create({
        data: { classId, skill: 'SPEAKING', seed: 'speech', status: 'READY', spec: {} },
      });
      const writingSection = await instance.database.classSection.create({
        data: { classId, skill: 'WRITING', seed: 'writing', status: 'READY', spec: {} },
      });
      const formativeSpeech = await instance.database.speakingPrompt.create({
        data: { sectionId: speechSection.id, order: 0, targetPhrase: 'Hola', translation: 'Hello' },
      });
      const formativeWriting = await instance.database.writingPrompt.create({
        data: { sectionId: writingSection.id, order: 0, task: 'Write a greeting' },
      });
      const sourceEpisode = await instance.database.episode.create({
        data: {
          userId: ownerId,
          title: 'Formative audio',
          topic: 'Greetings',
          script: { create: { turns: [{ speaker: 'HOST', text: 'Hola' }], markdown: 'Hola' } },
        },
        include: { script: true },
      });
      const sourceSection = await instance.database.classSection.create({
        data: {
          classId,
          skill: 'LISTENING',
          seed: 'source',
          status: 'READY',
          spec: {},
          episodeId: sourceEpisode.id,
        },
      });
      const sourceWithoutScript = await instance.database.episode.create({
        data: { userId: ownerId, title: 'Other formative audio', topic: 'Greetings' },
      });
      const unrelatedEpisode = await instance.database.episode.create({
        data: {
          userId: ownerId,
          title: 'Unrelated audio',
          topic: 'Greetings',
          script: { create: { turns: [], markdown: 'Unrelated' } },
        },
        include: { script: true },
      });
      await instance.database.classSection.update({
        where: { id: formative.id },
        data: { episodeId: sourceWithoutScript.id },
      });
      const saved = await instance.database.classAssessment.create({
        data: { ...assessment(1, 1), generationOperationId: operationId },
      });
      const listening = await instance.database.classAssessmentSection.create({
        data: { assessmentId: saved.id, skill: 'LISTENING', passThreshold: 0.7 },
      });
      const writing = await instance.database.classAssessmentSection.create({
        data: { assessmentId: saved.id, skill: 'WRITING', passThreshold: 0.7 },
      });
      const speaking = await instance.database.classAssessmentSection.create({
        data: { assessmentId: saved.id, skill: 'SPEAKING', passThreshold: 0.7 },
      });
      const criteria = [{ id: 'meaning', description: 'Conveys meaning', modality: 'TRANSCRIPT' }];
      const speakingPrompt = await instance.database.speakingPrompt.create({
        data: {
          assessmentSectionId: speaking.id,
          assessmentTaskMode: 'COMMUNICATIVE',
          assessmentRubric: 'Use a greeting',
          assessmentCriteria: criteria,
          order: 0,
          targetPhrase: 'Greet someone',
          translation: 'Saluda',
        },
      });
      await instance.database.writingPrompt.create({
        data: {
          assessmentSectionId: writing.id,
          order: 0,
          task: 'Write a greeting',
          assessmentRubric: 'Use a greeting',
        },
      });
      await expect(
        instance.database.episode.create({
          data: {
            userId: ownerId,
            title: 'Invalid assessment audio',
            topic: 'Assessment',
            assessmentAudioAssessmentId: saved.id,
            assessmentAudioSectionId: listening.id,
            assessmentAudioOperationId: operationId,
            audioGenerationKey: randomUUID(),
          },
        })
      ).rejects.toThrow(/must be admitted after creation/);
      const episode = await instance.database.$transaction(async (tx) => {
        const created = await tx.episode.create({
          data: {
            userId: ownerId,
            title: 'Assessment audio',
            topic: 'Assessment',
            assessmentAudioAssessmentId: saved.id,
            assessmentAudioSectionId: listening.id,
            assessmentAudioOperationId: operationId,
            script: { create: { turns: [{ speaker: 'HOST', text: 'Hola' }], markdown: 'Hola' } },
          },
        });
        await tx.classAssessmentSection.update({
          where: { id: listening.id },
          data: {
            episodeId: created.id,
            audioReservationEpisodeId: created.id,
            audioReservationOperationId: operationId,
          },
        });
        return created;
      });
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      let startedCount = 0;
      const staleWriter = (write: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        instance.database
          .$transaction(
            async (tx) => {
              await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { id: true } });
              if (++startedCount === 3) started();
              await gate;
              await write(tx);
            },
            { isolationLevel: 'Serializable', timeout: 15000 }
          )
          .then(
            () => null,
            (error: unknown) => error
          );
      const stale = [
        staleWriter((tx) =>
          order === 'episode-first'
            ? tx.script.update({
                where: { episodeId: episode.id },
                data: { soundCues: [{ type: 'effect', prompt: 'Stale cue' }] },
              })
            : tx.lessonQuestion.update({
                where: { id: formativeQuestion.id },
                data: { question: 'Stale source change' },
              })
        ),
        staleWriter((tx) =>
          order === 'course-first'
            ? tx.script.create({
                data: { episodeId: sourceWithoutScript.id, turns: [], markdown: 'Stale script' },
              })
            : tx.course.update({ where: { id: courseId }, data: { nativeLang: 'en' } })
        ),
        staleWriter((tx) => {
          if (order === 'episode-first') {
            return tx.episode.update({
              where: { id: sourceEpisode.id },
              data: { audioUrl: '/stale.mp3' },
            });
          }
          if (order === 'course-first') {
            return tx.script.update({
              where: { id: sourceEpisode.script!.id },
              data: { markdown: 'Stale script' },
            });
          }
          return tx.lesson.update({
            where: { id: classDetails.lessonId },
            data: { title: 'Stale lesson change' },
          });
        }),
      ];
      await ready;
      try {
        await instance.database.episode.update({
          where: { id: episode.id },
          data: { audioGenerationKey: randomUUID() },
        });
      } finally {
        release();
      }
      for (const error of await Promise.all(stale))
        expect(isSerializationConflict(error)).toBe(true);
      const freeze = await instance.database.assessmentAudioSourceFreeze.findUniqueOrThrow({
        where: { assessmentId: saved.id },
      });
      expect(freeze).toMatchObject({ classId, episodeId: episode.id });
      await expect(
        instance.database.classAssessment.update({
          where: { id: saved.id },
          data: { materialVersion: 2 },
        })
      ).rejects.toThrow(/material version cannot change/);
      await expect(
        instance.database.speakingPrompt.update({
          where: { id: speakingPrompt.id },
          data: { assessmentCriteria: [{ ...criteria[0]!, modality: 'ACOUSTIC' }] },
        })
      ).rejects.toThrow(/frozen by admitted audio/);
      await instance.database.speakingPrompt.update({
        where: { id: speakingPrompt.id },
        data: { assessmentCriteria: criteria },
      });
      await expect(
        instance.database.script.update({
          where: { episodeId: episode.id },
          data: { soundCues: [{ type: 'effect', prompt: 'Unreviewed cue' }] },
        })
      ).rejects.toThrow(/Assessment script is frozen/);
      await instance.database.script.update({
        where: { episodeId: episode.id },
        data: { markdown: 'Hola', verificationFeedback: 'Checked' },
      });
      await expect(
        instance.database.script.update({
          where: { episodeId: episode.id },
          data: { markdown: 'Changed' },
        })
      ).rejects.toThrow(/Assessment script is frozen/);
      expect(
        await instance.database.assessmentAudioProtectedMedia.findUniqueOrThrow({
          where: {
            assessmentId_episodeId: { assessmentId: saved.id, episodeId: sourceEpisode.id },
          },
        })
      ).toMatchObject({ classId });
      await expect(
        instance.database.episode.update({
          where: { id: sourceEpisode.id },
          data: { audioUrl: '/changed.mp3' },
        })
      ).rejects.toThrow(/Class source media is frozen/);
      await expect(
        instance.database.script.update({
          where: { id: sourceEpisode.script!.id },
          data: { markdown: 'Changed' },
        })
      ).rejects.toThrow(/Class source media is frozen/);
      await expect(
        instance.database.script.delete({ where: { id: sourceEpisode.script!.id } })
      ).rejects.toThrow();
      await expect(
        instance.database.script.create({
          data: { episodeId: sourceWithoutScript.id, turns: [], markdown: 'Late script' },
        })
      ).rejects.toThrow(/Class source media is frozen/);
      await expect(
        instance.database.script.update({
          where: { id: sourceEpisode.script!.id },
          data: { episodeId: unrelatedEpisode.id },
        })
      ).rejects.toThrow(/Class source media is frozen/);
      await expect(
        instance.database.script.update({
          where: { id: unrelatedEpisode.script!.id },
          data: { episodeId: sourceWithoutScript.id },
        })
      ).rejects.toThrow(/Class source media is frozen/);
      await instance.database.script.update({
        where: { id: sourceEpisode.script!.id },
        data: { markdown: sourceEpisode.script!.markdown },
      });
      await expect(
        instance.database.episode.delete({ where: { id: sourceEpisode.id } })
      ).rejects.toThrow();
      await expect(
        instance.database.classSection.update({
          where: { id: sourceSection.id },
          data: { episodeId: null },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await expect(
        instance.database.assessmentAudioSourceFreeze.update({
          where: { assessmentId: saved.id },
          data: { classId: 'different-class' },
        })
      ).rejects.toThrow(/freeze cannot change/);
      await expect(
        instance.database.assessmentAudioSourceFreeze.delete({ where: { assessmentId: saved.id } })
      ).rejects.toThrow(/freeze must remain/);
      await expect(
        instance.database.assessmentAudioSourceFreeze.create({
          data: { assessmentId: 'forged-assessment', classId, episodeId: 'forged-episode' },
        })
      ).rejects.toThrow(/binding is invalid/);
      await expect(
        instance.database.episode.delete({ where: { id: episode.id } })
      ).rejects.toThrow();
      await expect(
        instance.database.classAssessmentSection.delete({ where: { id: writing.id } })
      ).rejects.toThrow(/frozen by admitted audio/);
      await expect(
        instance.database.lessonQuestion.update({
          where: { id: formativeQuestion.id },
          data: { question: 'Changed teaching' },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await expect(
        instance.database.lessonQuestion.update({
          where: { id: formativeQuestion.id },
          data: { createdAt: new Date(formativeQuestion.createdAt.getTime() + 1000) },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await expect(
        instance.database.classSection.update({
          where: { id: formative.id },
          data: { createdAt: new Date(formative.createdAt.getTime() + 1000) },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await expect(
        instance.database.speakingPrompt.update({
          where: { id: formativeSpeech.id },
          data: { createdAt: new Date(formativeSpeech.createdAt.getTime() + 1000) },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await expect(
        instance.database.writingPrompt.update({
          where: { id: formativeWriting.id },
          data: { createdAt: new Date(formativeWriting.createdAt.getTime() + 1000) },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await instance.database.lessonQuestion.update({
        where: { id: formativeQuestion.id },
        data: { createdAt: formativeQuestion.createdAt },
      });
      await expect(
        instance.database.classSection.delete({ where: { id: formative.id } })
      ).rejects.toThrow(/Class teaching is frozen/);
      await expect(
        instance.database.courseClass.update({
          where: { id: classId },
          data: { sourceTitle: 'Changed source' },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await expect(
        instance.database.course.update({ where: { id: courseId }, data: { nativeLang: 'en' } })
      ).rejects.toThrow(/Course or lesson is frozen/);
      await expect(
        instance.database.lesson.update({
          where: { id: classDetails.lessonId },
          data: { title: 'Changed lesson' },
        })
      ).rejects.toThrow(/Course or lesson is frozen/);
      await instance.database.course.update({
        where: { id: courseId },
        data: { currentLevel: 'A2' },
      });
      await instance.database.lesson.update({
        where: { id: classDetails.lessonId },
        data: { estMinutes: 30 },
      });
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { learnerAnswers: { question: 0 }, writingDrafts: { draft: 'saved' } },
      });
      await expect(
        instance.database.courseClass.delete({ where: { id: classId } })
      ).rejects.toThrow(/deleted together/);
      await expect(
        instance.database.$transaction(async (tx) => {
          await tx.classAssessment.delete({ where: { id: saved.id } });
          await tx.episode.delete({ where: { id: episode.id } });
          await tx.courseClass.update({
            where: { id: classId },
            data: { sourceTitle: 'Changed source' },
          });
        })
      ).rejects.toThrow(/Class teaching is frozen|deleted together/);
      await instance.database.$transaction(async (tx) => {
        if (order === 'class-first') await tx.courseClass.delete({ where: { id: classId } });
        if (order === 'course-first') await tx.course.delete({ where: { id: courseId } });
        await tx.episode.delete({ where: { id: episode.id } });
        if (order === 'episode-first') await tx.episode.delete({ where: { id: sourceEpisode.id } });
        if (order === 'episode-first') await tx.courseClass.delete({ where: { id: classId } });
      });
      expect(
        await instance.database.classAssessment.findUnique({ where: { id: saved.id } })
      ).toBeNull();
      expect(await instance.database.episode.findUnique({ where: { id: episode.id } })).toBeNull();
      expect(
        await instance.database.assessmentAudioSourceFreeze.findUnique({
          where: { assessmentId: saved.id },
        })
      ).toBeNull();
      expect(
        await instance.database.assessmentAudioProtectedMedia.findMany({
          where: { assessmentId: saved.id },
        })
      ).toHaveLength(0);
      if (order === 'episode-first') {
        expect(
          await instance.database.episode.findUnique({ where: { id: sourceEpisode.id } })
        ).toBeNull();
      } else {
        await instance.database.episode.update({
          where: { id: sourceEpisode.id },
          data: { audioUrl: '/shared.mp3' },
        });
      }
    }
  );

  it.each(['insert', 'update', 'delete'] as const)(
    'fences a stale assessment snapshot when a provider call %s commits',
    async (mutation) => {
      const { instance, ownerId, assessment } = getContext();
      const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
      const call =
        mutation === 'insert'
          ? null
          : await instance.database.classAssessmentProviderCall.create({
              data: {
                assessmentId: saved.id,
                stage: 'REVIEW',
                ordinal: 0,
                role: 'MODEL',
                inputDigest: 'a'.repeat(64),
              },
            });
      let resume!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const reader = instance.database.$transaction(
        async (tx) => {
          await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { id: true } });
          started();
          await gate;
          await tx.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${saved.id} FOR UPDATE`;
          return tx.classAssessmentProviderCall.findMany({ where: { assessmentId: saved.id } });
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
      await ready;
      try {
        if (mutation === 'insert')
          await instance.database.classAssessmentProviderCall.create({
            data: {
              assessmentId: saved.id,
              stage: 'REVIEW',
              ordinal: 0,
              role: 'MODEL',
              inputDigest: 'a'.repeat(64),
            },
          });
        else if (mutation === 'update')
          await instance.database.classAssessmentProviderCall.update({
            where: { id: call!.id },
            data: { inputDigest: 'b'.repeat(64) },
          });
        else
          await instance.database.classAssessmentProviderCall.delete({ where: { id: call!.id } });
      } finally {
        resume();
      }
      const error = await reader.then(
        () => null,
        (cause: unknown) => cause
      );
      expect(isSerializationConflict(error)).toBe(true);
    },
    20000
  );

  it('fences both assessments when a provider call changes parent', async () => {
    const { instance, ownerId, courseId, classId, assessment } = getContext();
    const first = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const otherClass = await instance.database.courseClass.create({
      data: { courseId, lessonId: cls.lessonId, order: 2, status: 'IN_PROGRESS' },
    });
    const second = await instance.database.classAssessment.create({
      data: { ...assessment(1, 1), classId: otherClass.id },
    });
    const call = await instance.database.classAssessmentProviderCall.create({
      data: {
        assessmentId: first.id,
        stage: 'REVIEW',
        ordinal: 0,
        role: 'MODEL',
        inputDigest: 'a'.repeat(64),
      },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let begun = 0;
    let bothStarted!: () => void;
    const ready = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    const read = (assessmentId: string) =>
      instance.database
        .$transaction(
          async (tx) => {
            await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { id: true } });
            if (++begun === 2) bothStarted();
            await gate;
            await tx.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${assessmentId} FOR UPDATE`;
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
    const readers = [read(first.id), read(second.id)];
    await ready;
    try {
      await instance.database.classAssessmentProviderCall.update({
        where: { id: call.id },
        data: { assessmentId: second.id },
      });
    } finally {
      release();
    }
    for (const error of await Promise.all(readers))
      expect(isSerializationConflict(error)).toBe(true);
  }, 20000);

  it('freezes provider calls after sealing while allowing a full class cascade', async () => {
    const { instance, classId, assessment } = getContext();
    const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const call = await instance.database.classAssessmentProviderCall.create({
      data: {
        assessmentId: saved.id,
        stage: 'REVIEW',
        ordinal: 0,
        role: 'MODEL',
        inputDigest: 'a'.repeat(64),
      },
    });
    await instance.database.classAssessment.update({
      where: { id: saved.id },
      data: {
        status: 'READY',
        generationOperationId: 'provider-generation',
        reviewOperationId: 'provider-review',
        reviewedMaterialDigest: 'a'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    await expect(
      instance.database.classAssessmentProviderCall.create({
        data: {
          assessmentId: saved.id,
          stage: 'REVIEW',
          ordinal: 1,
          role: 'MODEL',
          inputDigest: 'a'.repeat(64),
        },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentProviderCall.update({
        where: { id: call.id },
        data: { inputDigest: 'b'.repeat(64) },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentProviderCall.delete({ where: { id: call.id } })
    ).rejects.toThrow();
    await instance.database.courseClass.delete({ where: { id: classId } });
    expect(
      await instance.database.classAssessmentProviderCall.findUnique({ where: { id: call.id } })
    ).toBeNull();
  });

  it('migrates legacy speaking and writing prompts without changing their parents or content', async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    const schema = `assessment_legacy_${randomUUID().replaceAll('-', '')}`;
    const connection = new Client({
      connectionString: url.toString(),
      options: `-c search_path=${schema},public`,
    });
    await connection.connect();
    try {
      await connection.query(`CREATE SCHEMA "${schema}"`);
      const directory = 'prisma/migrations';
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const entry of entries.filter((name) => name < '20261021103000_class_assessment'))
        await connection.query(await readFile(join(directory, entry, 'migration.sql'), 'utf8'));
      await connection.query(
        `INSERT INTO "SpeakingPrompt" (id, "order", "targetPhrase", translation) VALUES ('legacy-speaking', 1, 'Привет', 'Hola')`
      );
      await connection.query(
        `INSERT INTO "WritingPrompt" (id, "order", task) VALUES ('legacy-writing', 1, 'Saluda')`
      );
      await connection.query(
        await readFile(join(directory, '20261021103000_class_assessment', 'migration.sql'), 'utf8')
      );
      const speaking = await connection.query(
        `SELECT "targetPhrase", translation, "assessmentSectionId" FROM "SpeakingPrompt" WHERE id = 'legacy-speaking'`
      );
      const writing = await connection.query(
        `SELECT task, "assessmentSectionId" FROM "WritingPrompt" WHERE id = 'legacy-writing'`
      );
      expect(speaking.rows).toEqual([
        { targetPhrase: 'Привет', translation: 'Hola', assessmentSectionId: null },
      ]);
      expect(writing.rows).toEqual([{ task: 'Saluda', assessmentSectionId: null }]);
    } finally {
      await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await connection.end();
    }
  }, 120_000);
}
