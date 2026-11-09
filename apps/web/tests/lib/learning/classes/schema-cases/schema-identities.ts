import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import {
  currentClassSections,
  isCurrentClassSection,
} from '@/lib/learning/classes/progress/current-sections';
import type { AssessmentSchemaContext } from './schema-context';

export function registerSchemaIdentityCases(getContext: () => AssessmentSchemaContext) {
  it('keeps the assessment material version immutable from creation', async () => {
    const { instance, assessment } = getContext();
    const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    expect(saved.materialVersion).toBe(1);
    await expect(
      instance.database.classAssessment.update({
        where: { id: saved.id },
        data: { materialVersion: 2 },
      })
    ).rejects.toThrow(/material version cannot change/);
    await instance.database.classAssessment.update({
      where: { id: saved.id },
      data: { materialVersion: 1 },
    });
  });

  it('assigns fresh immutable identities when saved quiz rows are recreated', async () => {
    const { instance, classId } = getContext();
    const section = await instance.database.classSection.create({
      data: { classId, skill: 'GRAMMAR', seed: 'fixture', spec: {}, status: 'READY' },
    });
    const question = await instance.database.lessonQuestion.create({
      data: {
        sectionId: section.id,
        skill: 'GRAMMAR',
        order: 1,
        question: 'Choose one',
        options: ['one', 'two'],
        correctIndex: 0,
        explanation: 'One is correct.',
      },
    });
    await expect(
      instance.database.lessonQuestion.update({
        where: { id: question.id },
        data: { incarnationId: randomUUID() },
      })
    ).rejects.toThrow(/incarnation cannot change/);
    await expect(
      instance.database.classSection.update({
        where: { id: section.id },
        data: { incarnationId: randomUUID() },
      })
    ).rejects.toThrow(/incarnation cannot change/);
    const retained = await instance.database.classSection.upsert({
      where: { id: section.id },
      create: { id: section.id, classId, skill: 'GRAMMAR', seed: 'fixture', spec: {} },
      update: { seed: 'fixture' },
    });
    expect(retained.incarnationId).toBe(section.incarnationId);
    const upserted = await instance.database.$queryRaw<Array<{ incarnationId: string }>>`
      INSERT INTO "LessonQuestion"
        (id, "sectionId", "order", skill, question, options, "correctIndex", explanation)
      VALUES
        (${question.id}, ${section.id}, 1, 'GRAMMAR', 'Choose one',
         '["one", "two"]'::jsonb, 0, 'One is correct.')
      ON CONFLICT (id) DO UPDATE SET question = EXCLUDED.question
      RETURNING "incarnationId"
    `;
    expect(upserted[0]?.incarnationId).toBe(question.incarnationId);
    await expect(instance.database.$queryRaw`
      INSERT INTO "LessonQuestion"
        (id, "sectionId", "order", skill, question, options, "correctIndex", explanation)
      VALUES
        (${question.id}, ${section.id}, 1, 'GRAMMAR', 'Choose one',
         '["one", "two"]'::jsonb, 0, 'One is correct.')
      ON CONFLICT (id) DO UPDATE SET "incarnationId" = EXCLUDED."incarnationId"
    `).rejects.toThrow(/incarnation cannot change/);
    await instance.database.lessonQuestion.delete({ where: { id: question.id } });
    const recreatedQuestion = await instance.database.lessonQuestion.create({
      data: {
        id: question.id,
        incarnationId: question.incarnationId,
        createdAt: question.createdAt,
        sectionId: section.id,
        skill: 'GRAMMAR',
        order: 1,
        question: 'Choose one',
        options: ['one', 'two'],
        correctIndex: 0,
        explanation: 'One is correct.',
      },
    });
    expect(recreatedQuestion.incarnationId).not.toBe(question.incarnationId);
    await instance.database.classSection.delete({ where: { id: section.id } });
    const recreatedSection = await instance.database.classSection.create({
      data: {
        id: section.id,
        incarnationId: section.incarnationId,
        createdAt: section.createdAt,
        classId,
        skill: 'GRAMMAR',
        seed: 'fixture',
        spec: {},
        status: 'READY',
      },
    });
    expect(recreatedSection.incarnationId).not.toBe(section.incarnationId);
  });

  it('keeps withdrawn repair sections out of the current learner material', async () => {
    const { instance, classId } = getContext();
    const makeSection = (attempt: number, withdrawn: boolean) =>
      instance.database.classSection.create({
        data: { classId, skill: 'GRAMMAR', attempt, withdrawn, seed: randomUUID(), spec: {} },
      });
    const older = await makeSection(1, false);
    const current = await makeSection(2, false);
    const tied = await makeSection(2, false);
    const withdrawnTie = await makeSection(2, true);
    const withdrawnNewer = await makeSection(3, true);
    const rows = [older, current, tied, withdrawnTie, withdrawnNewer];
    expect(
      currentClassSections(rows)
        .map((section) => section.id)
        .sort()
    ).toEqual([current.id, tied.id].sort());
    for (const section of rows)
      expect(await isCurrentClassSection(instance.database, section)).toBe(
        section.id === current.id || section.id === tied.id
      );
  });

  it('waits for an existing source writer before installing the incarnation fence', async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    const schema = `incarnation_upgrade_${randomUUID().replaceAll('-', '')}`;
    const options = `-c search_path=${schema},public`;
    const migrator = new Client({ connectionString: url.toString(), options });
    const writer = new Client({ connectionString: url.toString(), options });
    await migrator.connect();
    await writer.connect();
    const database = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString(), options }, { schema }),
    });
    let migration: Promise<unknown> | undefined;
    try {
      await migrator.query(`CREATE SCHEMA "${schema}"`);
      const directory = 'prisma/migrations';
      const target = '20261107003000_formative_incarnation_fence';
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name < target)
        .map((entry) => entry.name)
        .sort();
      for (const entry of entries)
        await migrator.query(await readFile(join(directory, entry, 'migration.sql'), 'utf8'));
      const user = await database.user.create({ data: { email: `${randomUUID()}@example.test` } });
      const curriculum = await database.curriculum.create({
        data: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      });
      const lesson = await database.lesson.create({
        data: {
          curriculumId: curriculum.id,
          slug: 'first',
          level: 'A1',
          order: 1,
          title: 'First',
          objective: 'Greet',
          grammarPoints: [],
          targetVocab: [],
          vocabThemes: [],
        },
      });
      const course = await database.course.create({
        data: {
          userId: user.id,
          curriculumId: curriculum.id,
          nativeLang: 'es',
          targetLang: 'ru',
        },
      });
      const cls = await database.courseClass.create({
        data: { courseId: course.id, lessonId: lesson.id, order: 1 },
      });
      const section = { id: randomUUID() };
      await migrator.query(
        `INSERT INTO "ClassSection" (id, "classId", skill, seed, spec, "updatedAt")
         VALUES ($1, $2, 'GRAMMAR', 'fixture', '{}'::jsonb, now())`,
        [section.id, cls.id]
      );
      const pid = (await migrator.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await writer.query('BEGIN');
      await writer.query('UPDATE "ClassSection" SET seed = $1 WHERE id = $2', [
        'changed',
        section.id,
      ]);
      migration = migrator.query(await readFile(join(directory, target, 'migration.sql'), 'utf8'));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = await writer.query<{ waiting: boolean }>(
          "SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1",
          [pid]
        );
        if (state.rows[0]?.waiting) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await writer.query('COMMIT');
      await migration;
      migration = undefined;
      expect(
        (
          await database.classSection.findUniqueOrThrow({
            where: { id: section.id },
            select: { seed: true },
          })
        ).seed
      ).toBe('changed');
      const question = await database.lessonQuestion.create({
        data: {
          sectionId: section.id,
          skill: 'GRAMMAR',
          order: 1,
          question: 'Choose one',
          options: ['one', 'two'],
          correctIndex: 0,
          explanation: 'One is correct.',
        },
        select: { id: true },
      });
      const otherSection = { id: randomUUID() };
      await migrator.query(
        `INSERT INTO "ClassSection" (id, "classId", skill, seed, spec, "updatedAt")
         VALUES ($1, $2, 'READING', 'reading', '{}'::jsonb, now())`,
        [otherSection.id, cls.id]
      );
      const otherQuestion = await database.lessonQuestion.create({
        data: {
          sectionId: otherSection.id,
          skill: 'READING',
          order: 1,
          question: 'Read this',
          options: ['yes', 'no'],
          correctIndex: 1,
          explanation: 'No is correct.',
        },
        select: { id: true },
      });
      await writer.query('BEGIN');
      await writer.query('UPDATE "LessonQuestion" SET question = $1 WHERE id = $2', [
        'Updated before upgrade',
        question.id,
      ]);
      migration = migrator.query(
        await readFile(
          join(directory, '20261107004000_class_quiz_incarnations', 'migration.sql'),
          'utf8'
        )
      );
      blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = await writer.query<{ waiting: boolean }>(
          "SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1",
          [pid]
        );
        if (state.rows[0]?.waiting) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await writer.query('COMMIT');
      await migration;
      migration = undefined;
      await migrator.query(
        await readFile(
          join(directory, '20261107005000_withdrawn_repair_sections', 'migration.sql'),
          'utf8'
        )
      );
      const upgradedSection = await database.classSection.findUniqueOrThrow({
        where: { id: section.id },
      });
      const upgradedQuestion = await database.lessonQuestion.findUniqueOrThrow({
        where: { id: question.id },
      });
      const otherUpgradedSection = await database.classSection.findUniqueOrThrow({
        where: { id: otherSection.id },
      });
      const otherUpgradedQuestion = await database.lessonQuestion.findUniqueOrThrow({
        where: { id: otherQuestion.id },
      });
      expect(upgradedSection.incarnationId).toMatch(/^[a-f0-9-]{36}$/);
      expect(upgradedQuestion.incarnationId).toMatch(/^[a-f0-9-]{36}$/);
      expect(otherUpgradedSection.incarnationId).not.toBe(upgradedSection.incarnationId);
      expect(otherUpgradedQuestion.incarnationId).not.toBe(upgradedQuestion.incarnationId);
      expect(upgradedSection.seed).toBe('changed');
      expect(otherUpgradedSection.seed).toBe('reading');
      expect(upgradedQuestion.options).toEqual(['one', 'two']);
      expect(upgradedQuestion.question).toBe('Updated before upgrade');
      expect(otherUpgradedQuestion.options).toEqual(['yes', 'no']);
      expect(otherUpgradedQuestion.correctIndex).toBe(1);
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      if (migration) await migration.catch(() => {});
      await database.$disconnect();
      await writer.end();
      await migrator.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await migrator.end();
    }
  }, 120_000);

  it('backfills audio admitted by an older worker before the migration acquires its lock', async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    const schema = `assessment_upgrade_${randomUUID().replaceAll('-', '')}`;
    const options = `-c search_path=${schema},public`;
    const connection = new Client({ connectionString: url.toString(), options });
    const worker = new Client({ connectionString: url.toString(), options });
    await connection.connect();
    await worker.connect();
    const database = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString(), options }, { schema }),
    });
    try {
      await connection.query(`CREATE SCHEMA "${schema}"`);
      const directory = 'prisma/migrations';
      const target = '20261107001000_assessment_audio_material_freeze';
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name < target)
        .map((entry) => entry.name)
        .sort();
      for (const entry of entries)
        await connection.query(await readFile(join(directory, entry, 'migration.sql'), 'utf8'));
      const user = await database.user.create({ data: { email: `${randomUUID()}@example.test` } });
      const curriculum = await database.curriculum.create({
        data: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      });
      const lesson = await database.lesson.create({
        data: {
          curriculumId: curriculum.id,
          slug: 'first',
          level: 'A1',
          order: 1,
          title: 'First',
          objective: 'Greet',
          grammarPoints: [],
          targetVocab: [],
          vocabThemes: [],
        },
      });
      const course = await database.course.create({
        data: { userId: user.id, curriculumId: curriculum.id, nativeLang: 'es', targetLang: 'ru' },
      });
      const cls = await database.courseClass.create({
        data: { courseId: course.id, lessonId: lesson.id, order: 1, status: 'IN_PROGRESS' },
      });
      const operationId = randomUUID();
      const saved = { id: randomUUID() };
      await database.$executeRaw`
        INSERT INTO "ClassAssessment"
          (id, "classId", "courseId", "userId", "classAttempt", "assessmentAttempt",
           requirements, "formativeRevision", "teachingKind", "teachingReceiptId",
           "generationOperationId", "updatedAt")
        VALUES (${saved.id}, ${cls.id}, ${course.id}, ${user.id}, 1, 1,
                '{}'::jsonb, 'fixture', 'BASE', 'fixture', ${operationId}, CURRENT_TIMESTAMP)`;
      const section = await database.classAssessmentSection.create({
        data: { assessmentId: saved.id, skill: 'LISTENING', passThreshold: 0.7 },
      });
      const episode = await database.$transaction(async (tx) => {
        const created = await tx.episode.create({
          data: {
            userId: user.id,
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
            episodeId: created.id,
            audioReservationEpisodeId: created.id,
            audioReservationOperationId: operationId,
          },
        });
        return created;
      });
      let releaseStale!: () => void;
      let staleStarted!: () => void;
      const staleGate = new Promise<void>((resolve) => {
        releaseStale = resolve;
      });
      const staleReady = new Promise<void>((resolve) => {
        staleStarted = resolve;
      });
      const stale = database
        .$transaction(
          async (tx) => {
            await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true } });
            staleStarted();
            await staleGate;
            await tx.course.update({ where: { id: course.id }, data: { nativeLang: 'en' } });
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      await staleReady;
      await worker.query('BEGIN');
      await worker.query('UPDATE "Episode" SET "audioGenerationKey" = $1 WHERE id = $2', [
        randomUUID(),
        episode.id,
      ]);
      const migrating = connection.query(
        await readFile(join(directory, target, 'migration.sql'), 'utf8')
      );
      try {
        const observed = await Promise.race([
          migrating.then(() => 'finished'),
          new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 100)),
        ]);
        expect(observed).toBe('waiting');
      } finally {
        await worker.query('COMMIT');
      }
      try {
        await migrating;
      } finally {
        releaseStale();
      }
      expect(isSerializationConflict(await stale)).toBe(true);
      expect(
        await database.assessmentAudioSourceFreeze.findUniqueOrThrow({
          where: { assessmentId: saved.id },
        })
      ).toMatchObject({ classId: cls.id, episodeId: episode.id });
    } finally {
      await database.$disconnect();
      await worker.end();
      await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await connection.end();
    }
  }, 120_000);

  it.each([
    'question delete',
    'section delete',
    'question incarnation',
    'section incarnation',
  ] as const)('invalidates an older class snapshot after a retained %s changes', async (change) => {
    const { instance, classId } = getContext();
    const section = await instance.database.classSection.create({
      data: { classId, skill: 'GRAMMAR', seed: 'fixture', spec: {}, status: 'READY' },
    });
    const question = await instance.database.lessonQuestion.create({
      data: {
        sectionId: section.id,
        skill: 'GRAMMAR',
        order: 1,
        question: 'Choose one',
        options: ['one', 'two'],
        correctIndex: 0,
        explanation: 'One is correct.',
      },
    });
    let ready!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = instance.database
      .$transaction(
        async (tx) => {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId } });
          ready();
          await gate;
          await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      )
      .then(
        () => null,
        (error: unknown) => error
      );
    await started;
    try {
      if (change === 'question delete')
        await instance.database.lessonQuestion.delete({ where: { id: question.id } });
      else if (change === 'section delete')
        await instance.database.classSection.delete({ where: { id: section.id } });
      else if (change === 'question incarnation')
        await instance.database.lessonQuestion.update({
          where: { id: question.id },
          data: { createdAt: new Date(question.createdAt.getTime() + 1000) },
        });
      else
        await instance.database.classSection.update({
          where: { id: section.id },
          data: { createdAt: new Date(section.createdAt.getTime() + 1000) },
        });
    } finally {
      release();
    }
    expect(isSerializationConflict(await stale)).toBe(true);
  });
}
