// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getCourseVocabularyTargets } from '@/lib/course-materials/vocabulary-context';
import { formatNotesForPrompt, getCourseNote } from '@/lib/course-notes';
import { buildLearnerContext } from '@/lib/pedagogy';
import { planCourseContext } from '@/lib/course-materials/context';
import { materialStorageScopes } from '@/lib/course-materials';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null, generate: vi.fn() }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'anthropic', model: 'captured' }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owned imported course source against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let userId: string;
  let courseId: string;
  let execution: SottoProviderExecution;
  beforeAll(async () => {
    instance = await createSharedTestInstance('course_source');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });
  beforeEach(async () => {
    boundary.generate.mockReset();
    userId = (await instance.reset()).ownerId;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Source fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
          currentLevel: 'A2',
        },
      })
    ).id;
    await instance.database.courseNote.create({
      data: { courseId, body: 'Personal goals '.repeat(850).slice(0, 12000) },
    });
    execution = { userId, authorize: async () => ({ userId }) };
    boundary.generate.mockImplementation(async (_prompt, messages, request) => {
      if (request.jsonSchema.name === 'source_vocabulary_extraction') {
        const payload = JSON.parse(messages[0].content);
        const index = payload.passageWords.findIndex(
          (word: { surface: string }) => word.surface === 'gegangen'
        );
        expect(index).toBeGreaterThanOrEqual(0);
        return {
          content: JSON.stringify({
            words: [
              {
                lemma: 'gehen',
                gloss: 'go',
                pos: 'verb',
                sourceSpan: { startWordIndex: index, endWordIndex: index },
                questionIndices: [],
              },
            ],
          }),
          model: 'captured',
        };
      }
      const payload = JSON.parse(messages[0].content);
      return {
        content: JSON.stringify({
          items: payload.items.map((_item: unknown, index: number) => ({
            index,
            metadata: { acceptable: true, issues: [], feedback: [] },
            associations: [],
          })),
        }),
        model: 'captured',
      };
    });
  });

  function params() {
    return {
      courseId,
      userId,
      execution,
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A2',
      seed: 'class:attempt1',
    };
  }
  async function material(name: string, source: string, id = randomUUID()) {
    const createdAt = new Date();
    await writeStorageReference({
      database: instance.database,
      signal: new AbortController().signal,
      prefix: `materials/${userId}/${id}`,
      extension: 'txt',
      contentType: 'text/plain',
      body: Buffer.from(source),
      previousReference: () => null,
      captureAdmission: async (database) => {
        await database.courseMaterial.create({
          data: {
            id,
            userId,
            courseId,
            name,
            mimeType: 'text/plain',
            byteSize: Buffer.byteLength(source),
            extractedText: source,
            createdAt,
          },
        });
        return {
          ...(await materialStorageScopes(database, { id, userId, createdAt })),
          consumer: `material:${id}:original`,
          snapshot: null,
        };
      },
      validateAdmission: async (database) => {
        await materialStorageScopes(database, { id, userId, createdAt });
      },
      commit: async (database, originalUrl) => {
        await database.courseMaterial.update({ where: { id }, data: { originalUrl } });
      },
    });
    return id;
  }

  it('gives teaching and vocabulary identical bounded excerpts from every file including their endings', async () => {
    const sourceA =
      'Wort und Beispiel. '.repeat(4000) +
      'FINAL A: Explain the contrast and propose translation exercises.';
    const sourceB =
      'Reisen und lernen. '.repeat(4000) + 'FINAL B: Mia ist gestern nach Hause gegangen.';
    const first = await material('Vocab Deutsch.pdf', sourceA);
    const second = await material('Newer vocabulary.pdf', sourceB);
    const context = await getCourseNote(courseId, params().seed);
    expect(context.length).toBeLessThanOrEqual(12000);
    expect(context).toContain('Vocab Deutsch.pdf');
    expect(context).toContain('Newer vocabulary.pdf');
    expect(context).toContain('FINAL A: Explain the contrast and propose translation exercises.');
    expect(context).toContain('FINAL B: Mia ist gestern nach Hause gegangen.');
    expect(context).toContain('Selected source excerpts, not a complete index');
    expect(context).toContain('[head: code points');
    expect(context).toContain('[middle: code points');
    expect(context).toContain('[tail: code points');
    expect(await getCourseVocabularyTargets(params())).toEqual({
      imported: true,
      vocab: [{ lemma: 'gehen', gloss: 'go', pos: 'verb' }],
      context,
    });
    const author = boundary.generate.mock.calls.find(
      (call) => call[2].jsonSchema.name === 'source_vocabulary_extraction'
    )!;
    expect(JSON.parse(author[1][0].content).passageText).toBe(context);
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
    expect(await instance.database.learnerGrammar.count({ where: { courseId } })).toBe(0);
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: first } }))
        .extractedText
    ).toBe(sourceA);
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: second } }))
        .extractedText
    ).toBe(sourceB);
  });

  it('does not invent PDF content from a historical filename placeholder', async () => {
    const context = '[file] Vocab Deutsch.pdf\nUploaded placement material: Vocab Deutsch.pdf';
    await instance.database.courseNote.update({
      where: { courseId },
      data: { body: context },
    });
    expect(await getCourseVocabularyTargets(params())).toEqual({
      imported: false,
      vocab: [],
      context,
    });
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it('keeps a full saved note usable after the class variation is appended', async () => {
    const body = 'x'.repeat(11992) + 'NOTE END';
    await instance.database.courseNote.update({ where: { courseId }, data: { body } });
    const result = await getCourseVocabularyTargets(params());
    expect(result.imported).toBe(false);
    expect(result.context.length).toBeLessThan(10000);
    expect(result.context).toContain('NOTE END');
    const variation = `Class attempt 2 for ${courseId}: generate a fresh variation. Do not reuse the same examples, questions, prompts, or distractors from earlier attempts.`;
    expect(() =>
      formatNotesForPrompt(buildLearnerContext(result.context, 'GRAMMAR') + '\n\n' + variation)
    ).not.toThrow();
    expect(
      (await instance.database.courseNote.findUniqueOrThrow({ where: { courseId } })).body
    ).toBe(body);
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it('rejects sanitizer-expanded context before any provider dispatch or memory write', async () => {
    await instance.database.courseNote.update({
      where: { courseId },
      data: {
        body: '</UNTRUSTED_LEARNER_CONTEXT>'.repeat(350),
      },
    });
    await expect(getCourseVocabularyTargets(params())).rejects.toThrow('prompt limit');
    expect(boundary.generate).not.toHaveBeenCalled();
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
  });

  it('keeps the captured source context exact when notes change during extraction', async () => {
    await material('Uploaded.txt', 'Mia ist gestern nach Hause gegangen.');
    const context = await getCourseNote(courseId, params().seed);
    const original = boundary.generate.getMockImplementation()!;
    boundary.generate.mockImplementation(async (...args) => {
      if (args[2].jsonSchema.name === 'source_vocabulary_extraction')
        await instance.database.courseNote.update({
          where: { courseId },
          data: { body: 'A later edit must apply to the next class.' },
        });
      return original(...args);
    });
    const result = await getCourseVocabularyTargets(params());
    expect(result.context).toBe(context);
    expect(result.context).not.toContain('A later edit must apply');
    expect(
      (await instance.database.courseNote.findUniqueOrThrow({ where: { courseId } })).body
    ).toBe('A later edit must apply to the next class.');
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
  });

  it('reuses source-backed weak and unseen words without another extraction or SRS changes', async () => {
    const lemmas = [
      'reisen',
      'buchen',
      'lernen',
      'lesen',
      'schreiben',
      'gehen',
      'fahren',
      'schlafen',
    ];
    await material('Known source.txt', lemmas.join(' '));
    for (const [index, lemma] of lemmas.entries())
      await instance.database.learnerVocab.create({
        data: {
          courseId,
          lemma,
          translation: `Meaning of ${lemma}`,
          partOfSpeech: 'verb',
          reps: index === 0 ? 4 : 0,
          mastery: index === 0 ? 0.1 : 0,
          lapses: index === 0 ? 9 : 0,
          lastReviewed: index === 0 ? new Date('2026-01-01T00:00:00Z') : null,
          dueAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
    const before = await instance.database.learnerVocab.findMany({
      where: { courseId },
      orderBy: { id: 'asc' },
    });
    const result = await getCourseVocabularyTargets(params());
    expect(result.vocab[0]?.lemma).toBe('reisen');
    expect(result.vocab.map((word) => word.lemma).sort()).toEqual([...lemmas].sort());
    expect(
      boundary.generate.mock.calls.every(
        (call) => call[2].jsonSchema.name === 'reading_vocabulary_quality'
      )
    ).toBe(true);
    expect(
      await instance.database.learnerVocab.findMany({ where: { courseId }, orderBy: { id: 'asc' } })
    ).toEqual(before);
  });

  it('rejects a foreign actor before extracting or publishing source words', async () => {
    await material('Owned.txt', 'Mia ist gegangen.');
    await expect(
      getCourseVocabularyTargets({
        ...params(),
        execution: { userId, authorize: async () => ({ userId: 'foreign' }) },
      })
    ).rejects.toThrow('original learner');
    expect(boundary.generate).not.toHaveBeenCalled();
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
  });

  it('rejects a middle excerpt that clips besuchen into an apparent suchen word', async () => {
    const id = randomUUID();
    const length = 50000;
    const planned = planCourseContext(
      [
        { id: 'editable-course-note', name: 'Editable course note', length: 12000 },
        { id, name: 'Verbs.txt', length },
      ],
      params().seed
    ).find((document) => document.id === id)!;
    const start = planned.ranges.find((range) => range.label === 'middle')!.start;
    const source = [...'gehen lernen '.repeat(5000).slice(0, length)];
    source.splice(start - 3, 10, ...' besuchen ');
    const original = source.join('');
    expect(original).not.toMatch(/\bsuchen\b/u);
    expect(original.slice(start - 2, start + 6)).toBe('besuchen');
    await material('Verbs.txt', original, id);
    boundary.generate.mockImplementation(async (_prompt, messages, request) => {
      expect(request.jsonSchema.name).toBe('source_vocabulary_extraction');
      const payload = JSON.parse(messages[0].content);
      const index = payload.passageWords.findIndex(
        (word: { surface: string }) => word.surface === 'suchen'
      );
      expect(index).toBeGreaterThanOrEqual(0);
      return {
        content: JSON.stringify({
          words: [
            {
              lemma: 'suchen',
              gloss: 'search',
              pos: 'verb',
              sourceSpan: { startWordIndex: index, endWordIndex: index },
              questionIndices: [],
            },
          ],
        }),
        model: 'captured',
      };
    });
    await expect(getCourseVocabularyTargets(params())).rejects.toThrow('attribution');
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
  });

  it('fails before range reads when the complete document inventory cannot fit', () => {
    expect(() =>
      planCourseContext(
        Array.from({ length: 80 }, (_, index) => ({
          id: String(index),
          name: 'document '.repeat(30),
          length: 100000,
        })),
        'seed'
      )
    ).toThrow('cover every document');
  });

  it('keeps Unicode ranges valid and changes only the seeded middle between classes', () => {
    const first = planCourseContext([{ id: 'doc', name: 'Deutsch', length: 100000 }], 'first')[0]!;
    const second = planCourseContext(
      [{ id: 'doc', name: 'Deutsch', length: 100000 }],
      'second'
    )[0]!;
    expect(first.ranges[0]).toEqual(second.ranges[0]);
    expect(first.ranges[2]).toEqual(second.ranges[2]);
    expect(first.ranges[1]).not.toEqual(second.ranges[1]);
    expect(
      first.ranges.every(
        (range) => range.start >= 0 && range.end <= 100000 && range.start < range.end
      )
    ).toBe(true);
  });
});
