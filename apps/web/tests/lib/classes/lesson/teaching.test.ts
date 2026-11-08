import { beforeEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createSkillRequirements, type ClassTeaching } from '@sotto/shared';
import type { SourceDocuments } from '@/lib/providers/ai';
import type { Prisma } from '@/generated/prisma/client';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';
import {
  emptyTeachingCriticFixture,
  novelFindingCorroborationFixture,
  shapeTeachingProviderFixture,
} from '../quality/intro-provider-fixture';

const boundary = vi.hoisted(() => ({ author: vi.fn(), adjudicator: vi.fn(), requests: vi.fn() }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (...args: [string, unknown]) => ({
    provider: 'fixture',
    model: 'captured-model',
    execution: args[1],
  }),
  capturedLearningAiOptions: async (
    ai: { execution: { sourceDocuments?: SourceDocuments } },
    scope?: { includeSourceDocuments?: boolean }
  ) => ({
    model: 'captured-model',
    ...(scope?.includeSourceDocuments ? { sourceDocuments: ai.execution.sourceDocuments } : {}),
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/learning/classes/formative/class-memory', () => ({
  seedPublishedClassMemory: vi.fn(),
}));
vi.mock('@/lib/learning/classes/formative/class-material', () => ({
  assertStoredClassMaterial: vi.fn(),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema?: { name: string } }
    ) => {
      boundary.requests(system, messages, options);
      const corroboration = novelFindingCorroborationFixture(messages, options);
      if (corroboration) return corroboration;
      if (options.jsonSchema?.name === 'class_teaching_critic')
        return emptyTeachingCriticFixture(messages, options);
      if (options.jsonSchema?.name === 'class_teaching_adjudicator')
        return shapeTeachingProviderFixture(
          system,
          messages,
          options,
          await boundary.adjudicator(system, messages, options)
        );
      return boundary.author(system, messages, options);
    },
  }),
}));

import {
  generateClassTeaching,
  requireInitialA1TeachingReview,
  sealInitialA1TeachingSeed,
  materializeInitialA1TeachingSeed,
  teachingFromSeed,
} from '@/lib/classes/lesson/teaching';
import { classLanguagePolicy } from '@/lib/classes/class-language-policy';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { publishClassGeneration } from '@/lib/learning/classes/formative/class-generation-state';
import { countWords } from '@/lib/duration';
import {
  captureGenerationFailure,
  durableGenerationFailure,
} from '@/lib/classes/quality/generation-failure';

const params = {
  userId: 'u1',
  execution: blockedProviderExecution('u1'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  title: 'Hablar de ayer',
  objective: 'Describe completed activities.',
  grammarPoints: ['preterite'],
  targetVocab: [{ lemma: 'museo', gloss: 'museum' }],
  note: 'Use familiar museum and reading situations.',
};
const initialRequirements = createSkillRequirements({
  scope: 'CLASS',
  nativeLang: 'es',
  targetLang: 'ru',
  level: 'A1',
  ttsProvider: null,
  sttProvider: null,
});
const approved = {
  content: JSON.stringify({ items: [{ index: 0, acceptable: true, issues: [], feedback: [] }] }),
  model: 'captured-model',
};
const rejected = {
  content: JSON.stringify({
    items: [
      {
        index: 0,
        acceptable: false,
        issues: ['incorrect'],
        feedback: ['The explanation gives the wrong verb agreement.'],
      },
    ],
  }),
  model: 'captured-model',
};

function withWordCount(total: number): ClassTeaching {
  const unit = structuredClone(sampleTeaching);
  unit.explanation = 'idea '.repeat(200).trim();
  for (const example of unit.workedExamples) example.explanation = 'idea '.repeat(100).trim();
  unit.commonMistake.explanation = 'idea '.repeat(50).trim();
  unit.guidedPractice.explanation = 'idea '.repeat(50).trim();
  const words = countWords(
    [
      unit.title,
      unit.explanation,
      ...unit.workedExamples.flatMap((item) => Object.values(item)),
      ...Object.values(unit.commonMistake),
      ...Object.values(unit.guidedPractice),
    ].join(' ')
  );
  unit.explanation += ' idea'.repeat(total - words);
  return unit;
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.author
    .mockReset()
    .mockResolvedValue({ content: JSON.stringify(sampleTeaching), model: 'captured-model' });
  boundary.adjudicator.mockReset().mockResolvedValue(approved);
});

describe('class teaching', () => {
  it('binds an initial A1 teaching review to the unchanged unit and captured scope', async () => {
    const scope = {
      ...params,
      execution: { ...params.execution, initialA1Class: true },
      level: 'A1',
      nativeLang: 'es',
      targetLang: 'ru',
    };
    const unit = await generateClassTeaching(scope);
    expect(() => requireInitialA1TeachingReview(unit, scope)).not.toThrow();
    expect(() => requireInitialA1TeachingReview(structuredClone(unit), scope)).toThrow(
      'review is no longer valid'
    );
    expect(() =>
      requireInitialA1TeachingReview(unit, { ...scope, objective: 'Another goal' })
    ).toThrow();
    expect(() =>
      requireInitialA1TeachingReview(unit, { ...scope, execution: { ...scope.execution } })
    ).toThrow();
    const original = unit.guidedPractice.answer;
    unit.guidedPractice.answer = 'Changed answer';
    expect(() => requireInitialA1TeachingReview(unit, scope)).toThrow('review is no longer valid');
    unit.guidedPractice.answer = original;
    expect(() => requireInitialA1TeachingReview(unit, scope)).not.toThrow();
    const authorize = scope.execution.authorize;
    scope.execution.authorize = async () => ({ userId: 'u1' });
    expect(() => requireInitialA1TeachingReview(unit, scope)).toThrow('review is no longer valid');
    scope.execution.authorize = authorize;
    scope.execution.initialA1Class = false;
    expect(() => requireInitialA1TeachingReview(unit, scope)).toThrow('review is no longer valid');
  });

  it('materializes only the exact reviewed initial-A1 seed for publication', async () => {
    const scope = {
      ...params,
      execution: { ...params.execution, initialA1Class: true },
      level: 'A1',
      nativeLang: 'es',
      targetLang: 'ru',
      reviewScope: {
        classId: 'class-1',
        courseId: 'course-1',
        attempt: 1,
        requirements: initialRequirements,
        course: { nativeLang: 'es', targetLang: 'ru' },
        lesson: { id: 'lesson-1', title: params.title, objective: params.objective },
        sourceBefore: { title: null, url: null },
        sourceAfter: { title: null, url: null },
      },
    };
    const unit = await generateClassTeaching(scope);
    const seed = { teaching: unit, vocabIds: ['a'] };
    sealInitialA1TeachingSeed(seed, unit, scope);
    const expected = { classId: 'class-1', userId: 'u1', attempt: 1 };
    const materialized = materializeInitialA1TeachingSeed(seed, expected);
    expect(materialized).toEqual({ seed, scope: scope.reviewScope });
    expect(materialized.seed).not.toBe(seed);
    expect(materialized.seed.teaching).not.toBe(unit);
    expect(() =>
      materializeInitialA1TeachingSeed(seed, { ...expected, classId: 'another' })
    ).toThrow('scope changed');
    expect(() => materializeInitialA1TeachingSeed(seed, { ...expected, attempt: 2 })).toThrow(
      'scope changed'
    );
    expect(() =>
      materializeInitialA1TeachingSeed(seed, { ...expected, userId: 'another' })
    ).toThrow('scope changed');
    expect(() => materializeInitialA1TeachingSeed(structuredClone(seed), expected)).toThrow(
      'proof is unavailable'
    );
    seed.vocabIds.push('changed');
    expect(() => materializeInitialA1TeachingSeed(seed, expected)).toThrow(
      'review is no longer valid'
    );
    seed.vocabIds.pop();
    unit.explanation = 'Altered after review';
    expect(() => materializeInitialA1TeachingSeed(seed, expected)).toThrow(
      'review is no longer valid'
    );
  });

  it('publishes a private reviewed copy even if the original changes during a database wait', async () => {
    const scope = {
      ...params,
      execution: { ...params.execution, initialA1Class: true },
      level: 'A1',
      nativeLang: 'es',
      targetLang: 'ru',
      reviewScope: {
        classId: 'class-1',
        courseId: 'course-1',
        attempt: 1,
        requirements: initialRequirements,
        course: { nativeLang: 'es', targetLang: 'ru' },
        lesson: { id: 'lesson-1', title: params.title, objective: params.objective },
        sourceBefore: { title: null, url: null },
        sourceAfter: { title: null, url: null },
      },
    };
    const unit = await generateClassTeaching(scope);
    const seed = { teaching: unit };
    const original = unit.explanation;
    sealInitialA1TeachingSeed(seed, unit, scope);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const update = vi.fn().mockResolvedValue({});
    const database = {
      $queryRaw: vi.fn(async () => {
        await wait;
      }),
      courseClass: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ status: 'GENERATING', attempt: 1, course: { userId: 'u1' } }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          courseId: 'course-1',
          lessonId: 'lesson-1',
          sourceTitle: null,
          sourceUrl: null,
          skillRequirements: initialRequirements,
          course: { nativeLang: 'es', targetLang: 'ru' },
          lesson: { title: params.title, objective: params.objective },
        }),
        update,
      },
      course: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as Prisma.TransactionClient;
    const publication = publishClassGeneration(database, {
      classId: 'class-1',
      attempt: 1,
      userId: 'u1',
      data: { adaptiveSeed: seed },
      requireInitialA1TeachingProof: true,
    });
    unit.explanation = 'Changed while publication waited.';
    release();
    await publication;
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adaptiveSeed: expect.objectContaining({
            teaching: expect.objectContaining({ explanation: original }),
          }),
        }),
      })
    );
  });
  it('allows a reviewed regeneration to publish its newly prepared source', async () => {
    const scope = {
      ...params,
      objective: 'New source',
      execution: { ...params.execution, initialA1Class: true },
      level: 'A1',
      nativeLang: 'es',
      targetLang: 'ru',
      reviewScope: {
        classId: 'class-1',
        courseId: 'course-1',
        attempt: 2,
        requirements: initialRequirements,
        course: { nativeLang: 'es', targetLang: 'ru' },
        lesson: { id: 'lesson-1', title: params.title, objective: params.objective },
        sourceBefore: { title: 'Old source', url: 'https://example.com/old' },
        sourceAfter: { title: 'New source', url: 'https://example.com/new' },
      },
    };
    const unit = await generateClassTeaching(scope);
    const seed = { teaching: unit };
    sealInitialA1TeachingSeed(seed, unit, scope);
    const update = vi.fn().mockResolvedValue({});
    const database = {
      $queryRaw: vi.fn(),
      courseClass: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ status: 'GENERATING', attempt: 2, course: { userId: 'u1' } }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          courseId: 'course-1',
          lessonId: 'lesson-1',
          sourceTitle: 'Old source',
          sourceUrl: 'https://example.com/old',
          skillRequirements: initialRequirements,
          course: scope.reviewScope.course,
          lesson: { title: params.title, objective: params.objective },
        }),
        update,
      },
      course: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as Prisma.TransactionClient;
    await publishClassGeneration(database, {
      classId: 'class-1',
      attempt: 2,
      userId: 'u1',
      requireInitialA1TeachingProof: true,
      data: { adaptiveSeed: seed, sourceTitle: 'New source', sourceUrl: 'https://example.com/new' },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceTitle: 'New source',
          sourceUrl: 'https://example.com/new',
        }),
      })
    );
  });
  it('provides beginner directions in the learner language and keeps higher levels immersive', () => {
    const beginner = classLanguagePolicy({ level: 'A1', nativeLang: 'es', targetLang: 'ru' });
    const intermediate = classLanguagePolicy({ level: 'A2', nativeLang: 'es', targetLang: 'ru' });
    expect(beginner).toContain('outside target-language passages and spoken dialogue');
    expect(beginner).toContain('understand those directions, in es');
    expect(beginner).toContain(
      'Examples, passages and answer options should still exercise the target language'
    );
    expect(intermediate).toContain(
      'every learner-visible field must be in the target language (ru)'
    );
  });

  it('repairs a beginner unit rejected for an untaught guided request before publishing it', async () => {
    const candidate: ClassTeaching = {
      ...sampleTeaching,
      explanation: 'Saluda e identifica a una persona.',
      workedExamples: [
        {
          prompt: 'Saluda a un amigo.',
          answer: 'Привет!',
          explanation: '«Привет» significa «hola».',
        },
        {
          prompt: 'Da las gracias.',
          answer: 'Спасибо за чай. Пожалуйста.',
          explanation: 'Aquí «пожалуйста» significa «de nada».',
        },
      ],
      commonMistake: {
        incorrect: 'Привед!',
        correction: 'Привет!',
        explanation: '«Привет» es el saludo informal; se escribe con «т» al final.',
      },
      guidedPractice: {
        prompt: 'En una cafetería, pide «чай» con cortesía.',
        hint: 'Añade la fórmula de cortesía que acompaña una petición.',
        answer: 'Чай, пожалуйста.',
        explanation: '«Пожалуйста» significa «por favor» al pedir.',
      },
    };
    const replacement: ClassTeaching = {
      ...candidate,
      explanation:
        '«Чай» significa «té». Para pedir algo con cortesía, di el nombre y añade «пожалуйста», que aquí significa «por favor».',
      workedExamples: [
        {
          prompt: 'Pide agua.',
          answer: 'Вода, пожалуйста.',
          explanation: '«Вода» es agua; añade «пожалуйста» para pedirla con cortesía.',
        },
        candidate.workedExamples[1]!,
      ],
    };
    boundary.author
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' });
    boundary.adjudicator.mockResolvedValueOnce({
      content: JSON.stringify({
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['level'],
            feedback: ['The polite request pattern is only explained behind the guided answer.'],
          },
        ],
      }),
      model: 'captured-model',
    });
    const unit = await generateClassTeaching({
      ...params,
      execution: { ...params.execution, initialA1Class: true },
      level: 'A1',
      nativeLang: 'es',
      targetLang: 'ru',
    });
    expect(unit).toEqual(replacement);
    expect(unit.guidedPractice.answer).toBe(candidate.guidedPractice.answer);
    expect(unit.workedExamples[0]?.answer).not.toBe(unit.guidedPractice.answer);
    expect(boundary.author.mock.calls[0][0]).toContain(
      'they cannot teach a prerequisite for attempting that task'
    );
    expect(boundary.author.mock.calls[0][0]).toContain('do not assume prior ru knowledge');
    const critic = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema?.name === 'class_teaching_critic'
    );
    expect(critic?.[0]).toContain(
      'Do not use the concealed answer or its explanation as prior teaching'
    );
    const adjudicator = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema?.name === 'class_teaching_adjudicator'
    );
    const corroborator = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema?.name === 'class_teaching_novel_finding_corroboration'
    );
    expect(critic?.[0]).toContain('do not assume prior ru knowledge');
    expect(adjudicator?.[0]).toContain('do not assume prior ru knowledge');
    expect(corroborator?.[0]).toContain('do not assume prior ru knowledge');
  });
  it('reads the original workbook when authoring while keeping critic and adjudicator inputs isolated', async () => {
    const sourceDocuments: SourceDocuments = {
      parts: [
        {
          type: 'document',
          mediaType: 'application/pdf',
          name: 'Workbook.pdf',
          data: Buffer.from('%PDF-1.7'),
        },
      ],
      validate: async () => {},
    };
    expect(
      await generateClassTeaching({
        ...params,
        execution: { ...params.execution, sourceDocuments },
      })
    ).toEqual(sampleTeaching);
    expect(boundary.author.mock.calls[0][2].sourceDocuments).toBe(sourceDocuments);
    for (const [, , options] of boundary.requests.mock.calls)
      if (options.jsonSchema?.name !== 'class_teaching_generation')
        expect(options.sourceDocuments).toBeUndefined();
  });
  it('publishes a complete reviewed unit with worked reasoning before assessment', async () => {
    expect(await generateClassTeaching(params)).toEqual(sampleTeaching);
    for (const [, messages, options] of boundary.requests.mock.calls) {
      if (options.jsonSchema.name !== 'class_teaching_generation') {
        const input = JSON.parse(messages[0].content);
        expect(input.lessonContext).toEqual({
          title: params.title,
          objective: params.objective,
          grammarPoints: params.grammarPoints,
          targetVocab: params.targetVocab,
          learnerContext: params.note,
        });
        expect(input.items[0].content).toEqual(sampleTeaching);
      }
    }
    expect(boundary.requests.mock.calls[0][2]).toMatchObject({ model: 'captured-model' });
    expect(boundary.author.mock.calls[0][0]).toContain(
      'Write the returned learner-visible title in the language required by this policy'
    );
  });

  it('replaces incomplete teaching once and reviews the complete replacement', async () => {
    boundary.author.mockResolvedValueOnce({
      content: '{"title":"Only a label"}',
      model: 'captured-model',
    });
    const unit = await generateClassTeaching(params);
    expect(unit.workedExamples).toEqual(sampleTeaching.workedExamples);
    expect(unit.guidedPractice.answer).toBe(sampleTeaching.guidedPractice.answer);
    const review = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_teaching_critic'
    );
    expect(JSON.parse(review![1][0].content).items[0].content).toEqual(unit);
  });

  it('replaces an oversized lesson before review rather than publishing a long unbounded lesson', async () => {
    boundary.author.mockResolvedValueOnce({
      content: JSON.stringify({
        ...sampleTeaching,
        explanation: 'forma '.repeat(280),
        workedExamples: sampleTeaching.workedExamples.map((example) => ({
          ...example,
          explanation: 'uso '.repeat(190),
        })),
      }),
      model: 'captured-model',
    });
    expect(await generateClassTeaching(params)).toEqual(sampleTeaching);
    const review = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_teaching_critic'
    );
    expect(JSON.parse(review![1][0].content).items[0].content).toEqual(sampleTeaching);
    expect(boundary.author.mock.calls).toHaveLength(2);
  });

  it('reviews complete fields above the old word caps unchanged within the whole-unit budget', async () => {
    const candidate = structuredClone(sampleTeaching);
    candidate.explanation = 'Una explicación completa. '.repeat(60).trim();
    candidate.workedExamples[0]!.answer =
      'Ayer visité el museo con Ana porque queríamos conocer la historia de nuestra ciudad. Vimos una exposición sobre la vida cotidiana, hablamos con la guía y terminamos la visita en la sala de arte. Después fuimos a casa.';
    boundary.author.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    expect(countWords(candidate.explanation)).toBeGreaterThan(170);
    expect(countWords(candidate.workedExamples[0]!.answer)).toBeGreaterThan(35);
    expect(await generateClassTeaching(params)).toEqual(candidate);
    const validate = new Ajv().compile(boundary.author.mock.calls[0][2].jsonSchema.schema);
    expect(validate(candidate)).toBe(true);
    const reviewed = boundary.requests.mock.calls
      .filter(([, , options]) => options.jsonSchema.name === 'class_teaching_critic')
      .map(([, messages]) => JSON.parse(messages[0].content).items[0].content);
    expect(reviewed).toEqual([candidate]);
    expect(boundary.author.mock.calls).toHaveLength(1);
  });

  it('accepts exactly 600 words after the complete teaching review', async () => {
    const candidate = withWordCount(600);
    boundary.author.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    expect(await generateClassTeaching(params)).toEqual(candidate);
    const reviewed = boundary.requests.mock.calls
      .filter(([, , options]) => options.jsonSchema.name === 'class_teaching_critic')
      .map(([, messages]) => JSON.parse(messages[0].content).items[0].content);
    expect(reviewed).toEqual([candidate]);
    expect(boundary.author.mock.calls).toHaveLength(1);
  });

  it('repairs 601 words before review with exact total and field counts', async () => {
    const candidate = withWordCount(601);
    boundary.author.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    expect(await generateClassTeaching(params)).toEqual(sampleTeaching);
    const correction = JSON.parse(
      boundary.author.mock.calls[1][1][0].content.split('\n').slice(1).join('\n')
    );
    expect(correction.candidate).toEqual(candidate);
    expect(correction).toMatchObject({
      issues: ['teaching_word_limit'],
      maxWords: 600,
      actualWords: 601,
    });
    expect(correction.fields).toContainEqual({
      field: 'explanation',
      actualWords: countWords(candidate.explanation),
    });
    expect(
      correction.fields.reduce(
        (total: number, field: { actualWords: number }) => total + field.actualWords,
        0
      )
    ).toBe(601);
    expect(correction.fields.every((field: object) => !('maxWords' in field))).toBe(true);
    const reviewed = boundary.requests.mock.calls
      .filter(([, , options]) => options.jsonSchema.name === 'class_teaching_critic')
      .map(([, messages]) => JSON.parse(messages[0].content).items[0].content);
    expect(reviewed).toEqual([sampleTeaching]);
  });

  it('retains both over-budget drafts when a provider ignores the initial and repair word constraints', async () => {
    const candidates = [629, 615].map((total) => JSON.stringify(withWordCount(total)));
    boundary.author
      .mockResolvedValueOnce({ content: candidates[0], model: 'captured-model' })
      .mockResolvedValueOnce({ content: candidates[1], model: 'captured-model' });
    const error = await generateClassTeaching(params).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SectionQualityError);
    expect(captureGenerationFailure(error).attemptFailures).toEqual(
      candidates.map((candidate, index) => ({
        attempt: index + 1,
        type: 'structure',
        kind: 'teaching',
        candidate,
        issues: [{ code: 'teaching_word_limit' }],
      }))
    );
    expect(JSON.stringify(error)).not.toContain('idea');
  });

  it('repairs coupled teaching fields with indexed feedback and reviews the complete replacement', async () => {
    boundary.adjudicator.mockResolvedValueOnce(rejected);
    const candidate = {
      ...sampleTeaching,
      guidedPractice: {
        prompt: 'Cuenta que Ana comió en el museo ayer.',
        hint: 'Usa comió.',
        answer: 'Ana pidió comida en el museo ayer.',
        explanation: 'Pedir comida significa comerla.',
      },
    };
    const replacement = {
      ...sampleTeaching,
      guidedPractice: {
        prompt: 'Cuenta que Ana comió en el museo ayer.',
        hint: 'Relaciona el verbo con Ana y una actividad terminada.',
        answer: 'Ana comió en el museo ayer.',
        explanation: 'Comió expresa la actividad terminada de Ana.',
      },
    };
    boundary.author
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' });
    expect(await generateClassTeaching(params)).toEqual(replacement);
    const [system, messages, options] = boundary.author.mock.calls[1];
    expect(system).toContain(params.objective);
    expect(system).toContain('every required fact');
    expect(messages[0].content).toContain(
      'Repair the prompt, answer, explanation and hint together'
    );
    expect(JSON.parse(messages[0].content.slice(messages[0].content.indexOf('\n') + 1))).toEqual({
      candidate,
      issues: ['incorrect'],
      feedback: [
        {
          index: 0,
          feedback: [
            'The explanation gives the wrong verb agreement. Correction: Use accurate supported teaching.',
          ],
        },
      ],
    });
    expect(options.model).toBe('captured-model');
    const reviewed = boundary.requests.mock.calls
      .filter(([, , request]) => request.jsonSchema.name === 'class_teaching_critic')
      .map(([, request]) => JSON.parse(request[0].content).items[0].content);
    expect(reviewed).toEqual([candidate, replacement]);
  });

  it('shares one replacement budget across structural and teaching rejection', async () => {
    boundary.author.mockResolvedValueOnce({ content: 'invalid JSON', model: 'captured-model' });
    boundary.adjudicator.mockResolvedValue(rejected);
    await expect(generateClassTeaching(params)).rejects.toThrow('quality');
    expect(boundary.author.mock.calls).toHaveLength(2);
  });

  it('shares the single replacement between an oversized unit and rejected teaching', async () => {
    boundary.author.mockResolvedValueOnce({
      content: JSON.stringify(withWordCount(601)),
      model: 'captured-model',
    });
    boundary.adjudicator.mockResolvedValue(rejected);
    const error = await generateClassTeaching(params).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', issues: [{ code: 'teaching_word_limit' }] },
      { attempt: 2, type: 'teaching' },
    ]);
    expect(boundary.author.mock.calls).toHaveLength(2);
  });

  it.each([
    { ...sampleTeaching, title: 'x'.repeat(161) },
    { ...sampleTeaching, explanation: 'x'.repeat(1801) },
    { ...sampleTeaching, workedExamples: [sampleTeaching.workedExamples[0]] },
    {
      ...sampleTeaching,
      guidedPractice: { ...sampleTeaching.guidedPractice, answer: 'x'.repeat(801) },
    },
    { ...sampleTeaching, extra: 'untrusted' },
  ])(
    'rejects invalid structure and stored character limits before review: %#',
    async (candidate) => {
      boundary.author.mockResolvedValueOnce({
        content: JSON.stringify(candidate),
        model: 'captured-model',
      });
      expect(await generateClassTeaching(params)).toEqual(sampleTeaching);
      const validate = new Ajv().compile(boundary.author.mock.calls[0][2].jsonSchema.schema);
      expect(validate(candidate)).toBe(false);
      const reviewed = boundary.requests.mock.calls
        .filter(([, , options]) => options.jsonSchema.name === 'class_teaching_critic')
        .map(([, messages]) => JSON.parse(messages[0].content).items[0].content);
      expect(reviewed).toEqual([sampleTeaching]);
    }
  );

  it.each([
    ['invalid_json', '{incomplete'],
    ['invalid_item', JSON.stringify({ ...sampleTeaching, guidedPractice: undefined })],
    [
      'teaching_word_limit',
      JSON.stringify({
        ...sampleTeaching,
        explanation: 'uso '.repeat(400),
        workedExamples: sampleTeaching.workedExamples.map((example) => ({
          ...example,
          explanation: 'uso '.repeat(190),
        })),
      }),
    ],
  ])(
    'retains the actual terminal %s replacement beside the earlier semantic rejection',
    async (code, content) => {
      boundary.adjudicator.mockResolvedValueOnce(rejected);
      boundary.author
        .mockResolvedValueOnce({ content: JSON.stringify(sampleTeaching), model: 'captured-model' })
        .mockResolvedValueOnce({ content, model: 'captured-model' });
      const error = await generateClassTeaching(params).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(SectionQualityError);
      const captured = captureGenerationFailure(error);
      expect(captured.category).toBe('section_quality');
      expect(captured.attemptFailures).toEqual([
        { attempt: 1, type: 'teaching', failure: captured.teachingFailure },
        {
          attempt: 2,
          type: 'structure',
          kind: 'teaching',
          candidate: content,
          issues: [{ code }],
        },
      ]);
      expect(JSON.parse(captured.teachingFailure!.reviews[0]!.candidate!)[0].items).toEqual([
        sampleTeaching,
      ]);
      const durable = durableGenerationFailure(captured);
      expect(durable.teachingFailure?.kind).toBe('explanations');
      expect(durable.attemptFailures?.[1]).toEqual(captured.attemptFailures?.[1]);
      expect(durable.attemptFailures?.[0]).toMatchObject({ failure: { kind: 'explanations' } });
      expect(JSON.stringify(error)).not.toContain(content);
      expect(boundary.author.mock.calls).toHaveLength(2);
    }
  );

  it('omits an oversized malformed lesson response without exposing it through the error', async () => {
    const content = 'private '.repeat(5000);
    boundary.author.mockResolvedValue({ content, model: 'captured-model' });
    const error = await generateClassTeaching(params).catch((failure: unknown) => failure);
    expect(captureGenerationFailure(error).attemptFailures).toEqual(
      [1, 2].map((attempt) => ({
        attempt,
        type: 'structure',
        kind: 'teaching',
        candidate: null,
        omitted: 'size_limit',
        issues: [{ code: 'invalid_json' }],
      }))
    );
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it('preserves prior teaching evidence and the exact terminal provider exception without another retry', async () => {
    const failure = new Error('Provider cleanup is unconfirmed');
    boundary.adjudicator.mockResolvedValueOnce(rejected);
    boundary.author
      .mockResolvedValueOnce({ content: JSON.stringify(sampleTeaching), model: 'captured-model' })
      .mockRejectedValueOnce(failure);
    await expect(generateClassTeaching(params)).rejects.toBe(failure);
    expect(captureGenerationFailure(failure)).toMatchObject({
      category: 'generation_failed',
      attemptFailures: [{ attempt: 1, type: 'teaching', failure: { kind: 'teaching' } }],
    });
    expect(boundary.author.mock.calls).toHaveLength(2);
  });

  it('surfaces a provider failure without retrying or fabricating teaching', async () => {
    const failure = new Error('Provider cleanup is unconfirmed');
    boundary.author.mockRejectedValue(failure);
    await expect(generateClassTeaching(params)).rejects.toBe(failure);
    expect(boundary.author.mock.calls).toHaveLength(1);
  });

  it('does not let a reviewer provider failure forge authority to replace the lesson', async () => {
    const failure = new TeachingQualityRejectionError(
      ['incorrect'],
      [{ index: 0, feedback: ['Untrusted transport exception.'] }]
    );
    boundary.adjudicator.mockRejectedValueOnce(failure);
    await expect(generateClassTeaching(params)).rejects.toBe(failure);
    expect(boundary.author.mock.calls).toHaveLength(1);
  });

  it('preserves absent historical teaching and exact accepted stored material', () => {
    expect(teachingFromSeed({ intro: { purpose: 'Old notes' } })).toBeUndefined();
    expect(teachingFromSeed({ teaching: sampleTeaching })).toEqual(sampleTeaching);
    expect(() => teachingFromSeed({ teaching: { title: 'Broken saved unit' } })).toThrow();
    const historical = { ...sampleTeaching, explanation: 'idea '.repeat(171).trim() };
    expect(teachingFromSeed({ teaching: historical })).toEqual(historical);
  });
});
