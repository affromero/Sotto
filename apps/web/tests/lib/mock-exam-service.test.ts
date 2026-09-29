// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { createMockExam, ExamCourseNotFoundError } from '@/lib/mock-exam-service';
import { invalidateServerInfra } from '@/lib/server-config';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('persisted mock exams', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let faults: Array<{ model: string; operation: string; error: Error }>;
  beforeAll(async () => {
    instance = await createSharedTestInstance('mock_exams');
    binding.database = instance.database.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const index = faults.findIndex(
              (fault) => fault.model === model && fault.operation === operation
            );
            if (index !== -1) throw faults.splice(index, 1)[0].error;
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
  });
  beforeEach(async () => {
    faults = [];
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    invalidateServerInfra();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      update: {},
      create: {
        nativeLang: 'en',
        targetLang: 'de',
        title: 'German',
        lessons: {
          create: {
            level: 'B1',
            order: 1,
            slug: 'greetings',
            title: 'Greetings',
            objective: 'Greet a friend',
            grammarPoints: ['present'],
            vocabThemes: ['greetings'],
            targetVocab: [{ lemma: 'Hallo', gloss: 'Hello' }],
          },
        },
      },
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
          currentLevel: 'B1',
        },
      })
    ).id;
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'exam-fixture',
      aiBaseUrl: 'http://localhost:11434/v1',
    });
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'Provider unavailable for this test' } }, { status: 400 })
    );
  });
  afterEach(() => {
    invalidateServerInfra();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    if (instance) await instance.close();
    binding.database = null;
  });
  function execution() {
    const request = new Request('http://localhost:3000/api/v1/exams', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    return {
      userId: identity.ownerId,
      authorize: async (database: Parameters<typeof resolveSottoRequest>[0]) => {
        const current = await resolveSottoRequest(database, request);
        if (!current || current.kind !== 'content') throw new Error('Test session expired');
        return current;
      },
    };
  }
  it.each([
    ['CourseNote', 'findUnique'],
    ['Lesson', 'findMany'],
    ['ExamSection', 'create'],
    ['MockExam', 'update'],
  ])('marks the saved exam failed when %s.%s fails', async (model, operation) => {
    const error = new Error('Injected database operation failure');
    faults.push({ model, operation, error });
    await expect(createMockExam(courseId, identity.ownerId, execution())).rejects.toBe(error);
    const saved = await instance.database.mockExam.findMany({
      where: { courseId },
      include: { sections: true },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe('FAILED');
    expect(saved[0].sections.every((section) => section.status !== 'GENERATING')).toBe(true);
  });
  it('rejects another learner’s course without creating an exam', async () => {
    const other = await identity.household('Other learner');
    await expect(
      createMockExam(courseId, other.id, { ...execution(), userId: other.id })
    ).rejects.toBeInstanceOf(ExamCourseNotFoundError);
    expect(await instance.database.mockExam.findMany({ where: { courseId } })).toEqual([]);
  });
  it('preserves the original error when recording failure is also unavailable', async () => {
    const original = new Error('Exam specification read failed');
    faults.push(
      { model: 'Lesson', operation: 'findMany', error: original },
      { model: 'MockExam', operation: 'update', error: new Error('Database writes unavailable') }
    );
    await expect(createMockExam(courseId, identity.ownerId, execution())).rejects.toBe(original);
    expect(await instance.database.mockExam.findFirst({ where: { courseId } })).toMatchObject({
      status: 'GENERATING',
    });
  });
  it('persists failure for the whole exam when no provider section succeeds', async () => {
    const id = await createMockExam(courseId, identity.ownerId, execution());
    const saved = await instance.database.mockExam.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(saved.status).toBe('FAILED');
    expect(
      await instance.database.segment.count({ where: { episode: { userId: identity.ownerId } } })
    ).toBe(0);
    expect(saved.sections.map(({ skill, status }) => ({ skill, status }))).toEqual(
      expect.arrayContaining([
        { skill: 'READING', status: 'FAILED' },
        { skill: 'LISTENING', status: 'FAILED' },
        { skill: 'SPEAKING', status: 'FAILED' },
        { skill: 'WRITING', status: 'FAILED' },
      ])
    );
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ currentLevel: 'B1' });
  });
  it('settles unfinished sections when the first section failure write fails', async () => {
    faults.push({
      model: 'ExamSection',
      operation: 'update',
      error: new Error('Section write unavailable'),
    });
    await expect(createMockExam(courseId, identity.ownerId, execution())).rejects.toThrow(
      /400|unavailable/i
    );
    const saved = await instance.database.mockExam.findFirstOrThrow({
      where: { courseId },
      include: { sections: true },
    });
    expect(saved.status).toBe('FAILED');
    expect(saved.sections).toEqual([
      expect.objectContaining({ skill: 'READING', status: 'FAILED' }),
    ]);
  });
  it('keeps usable generated content when listening fails without advancing the course', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url !== 'http://localhost:11434/v1/chat/completions')
        throw new Error(`Unexpected provider destination: ${request.url}`);
      const body = (await request.json()) as {
        messages: Array<{ role: string; content: string }>;
        response_format?: { json_schema?: { name?: string } };
      };
      const prompt = body.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content)
        .join('\n');
      let content: unknown;
      if (body.response_format?.json_schema?.name === 'class_teaching_quality') {
        content = {
          items: JSON.parse(prompt).items.map((item: { index: number }) => ({
            index: item.index,
            acceptable: true,
            issues: [],
            feedback: [],
          })),
        };
      } else if (body.response_format?.json_schema?.name === 'class_section_quality') {
        content = {
          passageAcceptable: true,
          issues: [],
          questions: Array.from({ length: 5 }, (_, index) => ({
            index,
            acceptableOptionIndices: [0],
            issues: [],
          })),
        };
      } else if (/writing tasks/.test(prompt))
        content = [
          {
            task: 'Schreibe eine Einladung mit diesen Angaben.',
            taskType: 'guided_reply',
            sourceText: 'Kaffee mit Anna, Samstag um 15 Uhr im Café am Markt.',
            guidance: 'Verwende alle Angaben.',
          },
        ];
      else if (/speaking prompts/.test(prompt))
        content = [{ targetPhrase: 'Guten Morgen', translation: 'Good morning' }];
      else if (/questions|quiz/i.test(prompt))
        content = {
          passage: 'Anna trinkt morgens Kaffee.',
          questions: [
            'Was trinkt Anna?',
            'Welches Getränk trinkt Anna morgens?',
            'Was steht morgens in Annas Tasse?',
            'Welches Getränk nennt der Text?',
            'Was trinkt Anna am Morgen?',
          ].map((question) => ({
            question,
            options: ['Kaffee', 'Tee', 'Wasser', 'Saft'],
            correctIndex: 0,
            explanation: 'Anna drinks coffee.',
            passageRef: 'first sentence',
          })),
        };
      else
        return Response.json(
          { error: { message: 'Listening provider unavailable' } },
          { status: 400 }
        );
      return Response.json({
        id: 'exam-response',
        object: 'chat.completion',
        created: 1,
        model: 'exam-fixture',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(content) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
      });
    });
    const id = await createMockExam(courseId, identity.ownerId, execution());
    const saved = await instance.database.mockExam.findUniqueOrThrow({
      where: { id },
      include: {
        sections: { include: { questions: true, speakingPrompts: true, writingPrompts: true } },
      },
    });
    expect(saved).toMatchObject({
      userId: identity.ownerId,
      courseId,
      level: 'B1',
      status: 'READY',
    });
    expect(saved.sections.find((section) => section.skill === 'READING')).toMatchObject({
      status: 'READY',
      questions: expect.arrayContaining([
        expect.objectContaining({
          question: 'Was trinkt Anna?',
          options: ['Kaffee', 'Tee', 'Wasser', 'Saft'],
          correctIndex: 0,
          explanation: 'Anna drinks coffee.',
          passageText: 'Anna trinkt morgens Kaffee.',
        }),
      ]),
    });
    expect(saved.sections.find((section) => section.skill === 'WRITING')).toMatchObject({
      status: 'READY',
      writingPrompts: [
        expect.objectContaining({
          task: 'Schreibe eine Einladung mit diesen Angaben.\n\nKaffee mit Anna, Samstag um 15 Uhr im Café am Markt.',
        }),
      ],
    });
    expect(saved.sections.find((section) => section.skill === 'SPEAKING')).toMatchObject({
      status: 'READY',
      speakingPrompts: [
        expect.objectContaining({ targetPhrase: 'Guten Morgen', translation: 'Good morning' }),
      ],
    });
    expect(saved.sections.find((section) => section.skill === 'LISTENING')).toMatchObject({
      status: 'FAILED',
    });
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ currentLevel: 'B1' });
  });
});
