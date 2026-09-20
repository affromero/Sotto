// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import {
  collectStorageDeletionTargets,
  ownedStorageReferences,
  visitStorageDeletionReferences,
  type StorageDeletionReferencePage,
} from '@/lib/storage/sidedoor/deletion-targets';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('storage ownership collection with PostgreSQL', () => {
  let database: PrismaClient;
  const schema = `storage_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    database = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, options: `-c search_path=${schema}` },
        { schema }
      ),
    });
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const baseline = await readFile(
      'prisma/migrations/20260720021500_baseline/migration.sql',
      'utf8'
    );
    await database.$transaction(async (tx) => {
      for (const match of baseline.matchAll(/CREATE TYPE [\s\S]*?;/g))
        await tx.$executeRawUnsafe(match[0]);
      for (const match of baseline.matchAll(/CREATE TABLE "[^"]+" \([\s\S]*?\n\);/g))
        await tx.$executeRawUnsafe(match[0]);
    });
    for (const owner of ['first', 'second']) {
      await insert('User', {
        id: owner,
        email: `${owner}@example.test`,
        image: `${owner}/avatar.png`,
        updatedAt: new Date(),
      });
      await insert('Episode', {
        id: owner,
        userId: owner,
        title: owner,
        topic: owner,
        audioUrl: `${owner}/episode.mp3`,
        updatedAt: new Date(),
      });
      await insert('Segment', {
        id: owner,
        episodeId: owner,
        speaker: 'Host',
        text: 'Hello',
        order: 0,
        audioUrl: `${owner}/segment.mp3`,
        updatedAt: new Date(),
      });
      await insert('EpisodeVersion', {
        id: owner,
        episodeId: owner,
        version: 1,
        audioUrl: `${owner}/version.mp3`,
        changeType: 'initial',
      });
      await insert('Course', {
        id: owner,
        userId: owner,
        nativeLang: 'en',
        targetLang: 'es',
        curriculumId: 'curriculum',
        updatedAt: new Date(),
      });
      await insert('CourseClass', {
        id: owner,
        courseId: owner,
        lessonId: 'lesson',
        order: 0,
        worksheetPdfUrl: `${owner}/worksheet.pdf`,
        updatedAt: new Date(),
      });
      await insert('ClassSection', {
        id: owner,
        classId: owner,
        skill: 'SPEAKING',
        seed: 'seed',
        spec: '{}',
        updatedAt: new Date(),
      });
      await insert('PracticeSession', {
        id: owner,
        courseId: owner,
        kind: 'SPEAKING',
        items: '[]',
        seed: 'seed',
      });
      await insert('MockExam', {
        id: owner,
        userId: owner,
        courseId: owner,
        institution: 'CEFR_GENERIC',
        level: 'A1',
        blueprintId: 'blueprint',
        updatedAt: new Date(),
      });
      await insert('ExamSection', {
        id: owner,
        examId: owner,
        skill: 'SPEAKING',
        part: 'one',
        order: 0,
        format: 'oral',
        updatedAt: new Date(),
      });
      for (const parent of ['sectionId', 'practiceSessionId', 'examSectionId'])
        await insert('SpeakingPrompt', {
          id: `${owner}-${parent}`,
          [parent]: owner,
          order: 0,
          targetPhrase: 'Hola',
          translation: 'Hello',
          referenceTtsUrl: `${owner}/${parent}.mp3`,
        });
      await insert('SpeakingRecording', {
        id: owner,
        userId: owner,
        promptId: `${owner}-sectionId`,
        audioUrl: `${owner}/recording.mp3`,
        updatedAt: new Date(),
      });
      await insert('LearnerFocusTarget', {
        id: owner,
        courseId: owner,
        kind: 'WORD',
        text: 'Hola',
        normalizedText: 'hola',
        visualCueUrl: `${owner}/focus.png`,
        pronunciationAudioUrl: `${owner}/focus.mp3`,
        updatedAt: new Date(),
      });
    }
    await insert('SpeakingRecording', {
      id: 'cross-owner',
      userId: 'first',
      promptId: 'second-sectionId',
      audioUrl: 'first/cross-recording.mp3',
      updatedAt: new Date(),
    });
  }, 15000);
  afterAll(async () => {
    if (!database) return;
    await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.$disconnect();
  });
  async function insert(table: string, values: Record<string, string | number | Date>) {
    const columns = Object.keys(values);
    if (![table, ...columns].every((name) => /^[A-Za-z][A-Za-z0-9]*$/.test(name)))
      throw new Error('Invalid fixture identifier');
    await database.$executeRawUnsafe(
      `INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`,
      ...Object.values(values)
    );
  }
  it('collects every owned speaking path and recording without collecting another profile’s files', async () => {
    const targets = await database.$transaction(
      (tx) => collectStorageDeletionTargets(tx, { kind: 'profile', id: 'first' }),
      { isolationLevel: 'Serializable' }
    );
    expect(targets.episodePrefixes).toEqual(['episodes/first/']);
    expect(new Set(targets.episodeRefs)).toEqual(
      new Set(['first/episode.mp3', 'first/segment.mp3', 'first/version.mp3'])
    );
    expect(new Set(targets.explicitRefs)).toEqual(
      new Set([
        'first/avatar.png',
        'first/worksheet.pdf',
        'first/sectionId.mp3',
        'first/practiceSessionId.mp3',
        'first/examSectionId.mp3',
        'first/recording.mp3',
        'first/cross-recording.mp3',
        'first/focus.png',
        'first/focus.mp3',
      ])
    );
    expect(await database.user.count()).toBe(2);
    expect(await database.episode.count()).toBe(2);
  });
  it('keeps course cleanup scoped while instance cleanup includes both profiles', async () => {
    const course = await collectStorageDeletionTargets(database, {
      kind: 'course',
      id: 'first',
      episodeIds: ['first'],
    });
    expect(course.explicitRefs).not.toContain('first/avatar.png');
    expect(course.explicitRefs).not.toContain('first/cross-recording.mp3');
    expect(
      [...course.episodeRefs, ...course.explicitRefs].every((ref) => ref.startsWith('first/'))
    ).toBe(true);
    const all = await collectStorageDeletionTargets(database, { kind: 'instance' });
    expect(new Set(all.episodePrefixes)).toEqual(new Set(['episodes/first/', 'episodes/second/']));
  });
  it('captures independent exam-user and recording-practice cascades without collecting surviving prompts', async () => {
    await insert('MockExam', {
      id: 'cross-exam',
      userId: 'first',
      courseId: 'second',
      institution: 'CEFR_GENERIC',
      level: 'A1',
      blueprintId: 'blueprint',
      updatedAt: new Date(),
    });
    await insert('ExamSection', {
      id: 'cross-exam-section',
      examId: 'cross-exam',
      skill: 'SPEAKING',
      part: 'one',
      order: 0,
      format: 'oral',
      updatedAt: new Date(),
    });
    await insert('SpeakingPrompt', {
      id: 'cross-exam-prompt',
      examSectionId: 'cross-exam-section',
      order: 0,
      targetPhrase: 'Hola',
      translation: 'Hello',
      referenceTtsUrl: 'cross/exam-reference.mp3',
    });
    await insert('SpeakingRecording', {
      id: 'cross-practice-recording',
      userId: 'second',
      promptId: 'second-sectionId',
      practiceSessionId: 'first',
      audioUrl: 'cross/practice-recording.mp3',
      updatedAt: new Date(),
    });
    try {
      const pages: StorageDeletionReferencePage[] = [];
      await database.$transaction(
        (tx) =>
          visitStorageDeletionReferences(tx, { kind: 'profile', id: 'first' }, async (page) => {
            pages.push(page);
          }),
        { isolationLevel: 'Serializable' }
      );
      const prompts = pages.filter((page) => page.source === 'prompt').flatMap((page) => page.rows);
      expect(prompts).toContainEqual(
        expect.objectContaining({
          id: 'cross-exam-prompt',
          references: { referenceTtsUrl: 'cross/exam-reference.mp3' },
        })
      );
      expect(prompts.map((row) => row.id)).not.toContain('second-sectionId');
      expect(
        pages.filter((page) => page.source === 'recording').flatMap((page) => page.rows)
      ).toContainEqual(
        expect.objectContaining({
          id: 'cross-practice-recording',
          references: { audioUrl: 'cross/practice-recording.mp3' },
        })
      );
    } finally {
      await database.speakingRecording.deleteMany({ where: { id: 'cross-practice-recording' } });
      await database.speakingPrompt.deleteMany({ where: { id: 'cross-exam-prompt' } });
      await database.examSection.deleteMany({ where: { id: 'cross-exam-section' } });
      await database.mockExam.deleteMany({ where: { id: 'cross-exam' } });
    }
  });
  it('pages every owned row and preserves unknown URLs, field provenance and empty episode prefixes', async () => {
    await database.$executeRawUnsafe(`
      INSERT INTO "Episode" ("id", "userId", "title", "topic", "audioUrl", "pdfUrl", "updatedAt")
      SELECT 'scan-' || lpad(item::text, 3, '0'), 'first', 'Scan', 'Scan',
        CASE WHEN item % 3 = 0 THEN NULL ELSE 'https://historical.example/' || item || '.mp3' END,
        CASE WHEN item % 3 = 0 THEN NULL ELSE 'unknown/' || item || '.pdf' END, now()
      FROM generate_series(1,205) AS item
    `);
    try {
      const pages: StorageDeletionReferencePage[] = [];
      await database.$transaction(
        (tx) =>
          visitStorageDeletionReferences(tx, { kind: 'profile', id: 'first' }, async (page) => {
            pages.push(page);
          }),
        { isolationLevel: 'Serializable' }
      );
      expect(pages.every((page) => page.rows.length <= 100)).toBe(true);
      const episodePages = pages.filter((page) => page.source === 'episode');
      expect(episodePages.map((page) => page.rows.length)).toEqual([100, 100, 6]);
      const episodes = episodePages.flatMap((page) => page.rows);
      expect(new Set(episodes.map((row) => row.id))).toEqual(
        new Set([
          'first',
          ...Array.from(
            { length: 205 },
            (_, index) => `scan-${String(index + 1).padStart(3, '0')}`
          ),
        ])
      );
      expect(episodes.find((row) => row.id === 'scan-001')).toEqual({
        id: 'scan-001',
        episodePrefix: 'episodes/scan-001/',
        references: { audioUrl: 'https://historical.example/1.mp3', pdfUrl: 'unknown/1.pdf' },
      });
      expect(episodes.find((row) => row.id === 'scan-003')).toEqual({
        id: 'scan-003',
        episodePrefix: 'episodes/scan-003/',
        references: {},
      });
      expect(pages.find((page) => page.source === 'recording')?.rows.map((row) => row.id)).toEqual([
        'cross-owner',
        'first',
      ]);
    } finally {
      await database.episode.deleteMany({ where: { id: { startsWith: 'scan-' } } });
    }
  });
  it('rolls back application changes when snapshot persistence fails', async () => {
    const before = await database.user.findUniqueOrThrow({
      where: { id: 'first' },
      select: { image: true },
    });
    await expect(
      database.$transaction(
        async (tx) => {
          await tx.user.update({
            where: { id: 'first' },
            data: { image: '/avatars/toucan.png' },
            select: { id: true },
          });
          await visitStorageDeletionReferences(
            tx,
            { kind: 'profile', id: 'first' },
            async (page) => {
              if (page.source !== 'user') return;
              expect(page.rows).toEqual([
                { id: 'first', references: { image: '/avatars/toucan.png' } },
              ]);
              throw new Error('Manifest persistence failed');
            }
          );
          await tx.user.delete({ where: { id: 'first' }, select: { id: true } });
        },
        { isolationLevel: 'Serializable' }
      )
    ).rejects.toThrow('Manifest persistence failed');
    expect(
      await database.user.findUniqueOrThrow({ where: { id: 'first' }, select: { image: true } })
    ).toEqual(before);
    expect(await database.episode.count({ where: { userId: 'first' } })).toBe(1);
  });
});

it('excludes external URLs and bundled assets from storage cleanup', () => {
  expect(
    ownedStorageReferences(
      [
        '/avatars/cat.png',
        'data:image/png;base64,x',
        'https://other.example/image.png',
        'https://bucket.example/key',
        'files/audio.mp3',
        'files/audio.mp3',
      ],
      'https://bucket.example'
    )
  ).toEqual(['https://bucket.example/key', 'files/audio.mp3']);
});
