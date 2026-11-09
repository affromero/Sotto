import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleTeaching } from '../../helpers/learning/class-teaching';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  emptyTeachingCriticFixture,
  shapeTeachingProviderFixture,
} from '../classes/quality/intro-provider-fixture';

const boundary = vi.hoisted(() => ({
  requests: vi.fn(),
  leak: false,
  ai: null as { apiKey?: string } | null,
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (...args: [string, unknown]) => {
    const ai = {
      provider: 'fixture',
      model: 'captured',
      apiKey: 'fixture-key',
      execution: { ...(args[1] as object) },
    };
    boundary.ai = ai;
    return ai;
  },
  capturedLearningAiOptions: async () => ({ model: 'captured' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema: { name: string } }
    ) => {
      boundary.requests(system, messages, options);
      const name = options.jsonSchema.name;
      if (name === 'class_teaching_critic') return emptyTeachingCriticFixture(messages, options);
      const input =
        name === 'class_section_questions' ? undefined : JSON.parse(messages[0].content);
      if (name === 'class_teaching_adjudicator')
        return shapeTeachingProviderFixture(system, messages, options, {
          model: 'captured',
          content: JSON.stringify({
            items: input.items.map(({ index }: { index: number }) => ({
              index,
              acceptable: true,
              issues: [],
              feedback: [],
            })),
          }),
        });
      if (name === 'class_section_quality')
        return {
          model: 'captured',
          content: JSON.stringify({
            passageFindings: [],
            issues: [],
            questions: input.questions.map(
              (question: { index: number; question: string; options: string[] }) => ({
                index: question.index,
                acceptableOptionIndices: [
                  question.options.indexOf(authored[question.index].options[0]),
                ],
                issues: question.question.includes('respuesta: visité') ? ['unsupported'] : [],
              })
            ),
          }),
        };
      const leaked = boundary.leak;
      boundary.leak = false;
      return {
        model: 'captured',
        content: JSON.stringify({
          passage: '',
          questions: authored.map((question, index) => ({
            ...question,
            ...(leaked && index === 0 ? { taskContext: 'La respuesta: visité.' } : {}),
            correctIndex: 0,
            passageRef: '',
          })),
        }),
      };
    },
  }),
}));

import {
  generateSectionQuestions,
  requireInitialA1SectionReview,
  bindInitialA1SectionReview,
  sealInitialA1SectionReviews,
  materializeInitialA1SectionReviews,
} from '@/lib/class-generation';
const authored = [
  {
    taskContext: 'Cuenta una visita terminada de ayer con yo.',
    question: 'Ayer yo _____ el museo.',
    options: ['visité', 'visitó', 'visitaron', 'visitaste'],
    explanation: 'Visité concuerda con yo en el pasado.',
  },
  {
    taskContext: 'Ana terminó un libro ayer. Elige la oración que conserva esa información.',
    question: '¿Qué ocurrió?',
    options: [
      'Ana terminó el libro ayer.',
      'Ana empezó el libro ayer.',
      'Ana terminará el libro mañana.',
      'Yo terminé el libro ayer.',
    ],
    explanation: 'La primera oración conserva la persona, la actividad y el momento.',
  },
  {
    taskContext: 'Corrige la concordancia sin cambiar quién visitó el museo.',
    question: 'Yo visitó el museo ayer.',
    options: [
      'Yo visité el museo ayer.',
      'Ana visitó el museo ayer.',
      'Yo visitaré el museo mañana.',
      'Ellos visitaron el museo ayer.',
    ],
    explanation: 'Visité expresa la visita terminada de yo.',
  },
  {
    taskContext: 'Cuenta la misma actividad como terminada ayer.',
    question: 'Ana termina el libro hoy.',
    options: [
      'Ana terminó el libro ayer.',
      'Ana termina el libro mañana.',
      'Yo terminé el libro ayer.',
      'Ana empezó el libro ayer.',
    ],
    explanation: 'Terminó conserva la actividad y la persona, y ayer indica el nuevo momento.',
  },
  {
    taskContext: 'Cuenta una actividad terminada de Ana.',
    question: 'Ana _____ el museo ayer.',
    options: ['visitó', 'visité', 'visitaste', 'visitaron'],
    explanation: 'Visitó concuerda con Ana.',
  },
];
const params = {
  userId: 'u1',
  execution: blockedProviderExecution('u1'),
  skill: 'GRAMMAR' as const,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Describe a completed visit.',
  grammarPoints: ['preterite'],
  targetVocab: [],
  seed: 'class-1-GRAMMAR-1',
  teaching: sampleTeaching,
};

beforeEach(() => {
  boundary.requests.mockReset();
  boundary.leak = false;
  boundary.ai = null;
});

describe('assessing the accepted lesson', () => {
  it('binds accepted first-A1 questions to the exact class, teaching and private answer keys', async () => {
    const scope = {
      ...params,
      teaching: structuredClone(sampleTeaching),
      level: 'A1',
      execution: {
        ...params.execution,
        initialA1Class: true,
        learningSelection: { provider: 'fixture', model: 'model-a', credentialFingerprint: null },
      },
      reviewScope: { classId: 'class-1', courseId: 'course-1', sectionId: 'section-1', attempt: 1 },
    };
    const questions = await generateSectionQuestions(scope);
    const assessed = questions.map((question) => ({
      ...structuredClone(question),
      learningAssessment: null,
    }));
    expect(requireInitialA1SectionReview(questions, scope, assessed)).toHaveLength(
      questions.length
    );
    const ids = questions.map((_, index) => `question-${index}`);
    const receipt = bindInitialA1SectionReview(questions, scope, assessed, ids);
    const seed = { teaching: scope.teaching };
    const sealScope = {
      classId: 'class-1',
      courseId: 'course-1',
      userId: 'u1',
      attempt: 1,
      skills: ['GRAMMAR'] as const,
      level: scope.level,
      nativeLang: scope.nativeLang,
      targetLang: scope.targetLang,
      objective: scope.objective,
      grammarPoints: scope.grammarPoints,
      targetVocab: scope.targetVocab,
    };
    expect(() =>
      sealInitialA1SectionReviews(seed, scope.teaching, [receipt], {
        ...sealScope,
        objective: 'Changed objective',
      })
    ).toThrow('exercise review is no longer valid');
    sealInitialA1SectionReviews(seed, scope.teaching, [receipt], sealScope);
    const stored = materializeInitialA1SectionReviews(seed, {
      classId: 'class-1',
      userId: 'u1',
      attempt: 1,
    });
    expect(stored[0].questions.map((question) => question.id)).toEqual(ids);
    expect(() =>
      materializeInitialA1SectionReviews(seed, { classId: 'other', userId: 'u1', attempt: 1 })
    ).toThrow();
    expect(() =>
      bindInitialA1SectionReview(
        questions,
        scope,
        assessed,
        ids.map(() => 'same')
      )
    ).toThrow();
    expect(() => requireInitialA1SectionReview(structuredClone(questions), scope)).toThrow(
      'exercise review is no longer valid'
    );
    const changed = structuredClone(assessed);
    changed[0].correctIndex = (changed[0].correctIndex + 1) % changed[0].options.length;
    expect(() => requireInitialA1SectionReview(questions, scope, changed)).toThrow(
      'exercise review is no longer valid'
    );
    expect(() => requireInitialA1SectionReview(questions, scope, [...assessed].reverse())).toThrow(
      'exercise review is no longer valid'
    );
    scope.execution.learningSelection = { ...scope.execution.learningSelection, model: 'model-b' };
    expect(() => requireInitialA1SectionReview(questions, scope)).toThrow(
      'exercise review is no longer valid'
    );
    scope.execution.learningSelection = { ...scope.execution.learningSelection, model: 'model-a' };
    scope.teaching.explanation = 'Changed teaching';
    expect(() => requireInitialA1SectionReview(questions, scope)).toThrow(
      'exercise review is no longer valid'
    );
  });

  it('rejects a first-A1 section if teaching changes while its reviewer is running', async () => {
    const scope = {
      ...params,
      teaching: structuredClone(sampleTeaching),
      level: 'A1',
      execution: { ...params.execution, initialA1Class: true },
      reviewScope: { classId: 'class-1', courseId: 'course-1', sectionId: 'section-1', attempt: 1 },
    };
    boundary.requests.mockImplementation((_system, _messages, options) => {
      if (options.jsonSchema.name === 'class_teaching_critic')
        scope.teaching.explanation = 'Changed during review';
    });
    await expect(generateSectionQuestions(scope)).rejects.toThrow(
      'Class generation failed its educational quality check.'
    );
    boundary.requests.mockReset();
  });

  it.each(['cleanup', 'audio registration', 'workspace cleanup'] as const)(
    'invalidates a reviewed section when %s authority changes',
    async (changedAuthority) => {
      const execution: SottoProviderExecution = {
        ...params.execution,
        initialA1Class: true,
        onCleanupError: () => {},
        registerAudioEpisode: async () => {},
        isolatedWorkspace: { directory: '/tmp/review', markCleanupUnconfirmed: () => {} },
      };
      const scope = {
        ...params,
        execution,
        teaching: structuredClone(sampleTeaching),
        level: 'A1',
        reviewScope: {
          classId: 'class-1',
          courseId: 'course-1',
          sectionId: 'section-1',
          attempt: 1,
        },
      };
      const questions = await generateSectionQuestions(scope);
      if (changedAuthority === 'cleanup') execution.onCleanupError = () => {};
      if (changedAuthority === 'audio registration')
        execution.registerAudioEpisode = async () => {};
      if (changedAuthority === 'workspace cleanup')
        execution.isolatedWorkspace!.markCleanupUnconfirmed = () => {};
      expect(() => requireInitialA1SectionReview(questions, scope)).toThrow(
        'exercise review is no longer valid'
      );
    }
  );

  it('rejects a first-A1 section if the captured provider credential changes during review', async () => {
    const scope = {
      ...params,
      teaching: structuredClone(sampleTeaching),
      level: 'A1',
      execution: { ...params.execution, initialA1Class: true },
      reviewScope: { classId: 'class-1', courseId: 'course-1', sectionId: 'section-1', attempt: 1 },
    };
    boundary.requests.mockImplementation((_system, _messages, options) => {
      if (options.jsonSchema.name === 'class_teaching_critic' && boundary.ai)
        boundary.ai.apiKey = 'changed-key';
    });
    await expect(generateSectionQuestions(scope)).rejects.toThrow(
      'Class generation failed its educational quality check.'
    );
  });
  it('does not require later beginner lessons to reteach every background word', async () => {
    const questions = await generateSectionQuestions({ ...params, level: 'A1' });
    expect(questions).toHaveLength(authored.length);
    const review = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_teaching_critic'
    );
    expect(review?.[0]).toContain(
      'do not require later A1 lessons to reteach every background word'
    );
  });

  it('keeps standalone beginner practice usable without an invented prior lesson', async () => {
    const questions = await generateSectionQuestions({
      ...params,
      level: 'A1',
      teaching: undefined,
    });
    expect(questions).toHaveLength(authored.length);
    const review = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_teaching_critic'
    );
    expect(review?.[0]).toContain('When no teaching is supplied, assess standalone practice');
    const input = JSON.parse(review![1][0].content);
    expect(input.lessonContext.teaching).toBeUndefined();
  });

  it('reviews first A1 questions using teaching available before the guided answer', async () => {
    const original = structuredClone(sampleTeaching);
    await generateSectionQuestions({
      ...params,
      level: 'A1',
      execution: { ...params.execution, initialA1Class: true },
    });
    const reviews = boundary.requests.mock.calls.filter(
      ([, , options]) => options.jsonSchema.name !== 'class_section_questions'
    );
    expect(reviews.length).toBeGreaterThan(1);
    for (const [system, messages] of reviews) {
      const teaching = JSON.parse(messages[0].content).lessonContext.teaching;
      expect(teaching.guidedPractice).toEqual({
        prompt: sampleTeaching.guidedPractice.prompt,
        hint: sampleTeaching.guidedPractice.hint,
      });
      expect(teaching.workedExamples).toEqual(sampleTeaching.workedExamples);
      expect(system).toContain('guided answer and explanation are intentionally omitted');
      expect(system).toContain('Neither is prior explained teaching');
    }
    expect(sampleTeaching).toEqual(original);
  });

  it('reviews the exact published choices and accepted teaching without exposing the private answer key to blind review', async () => {
    const questions = await generateSectionQuestions(params);
    expect(new Set(questions.map(({ correctIndex }) => correctIndex)).size).toBeGreaterThan(1);
    questions.forEach((question, index) =>
      expect(question.options[question.correctIndex]).toBe(authored[index].options[0])
    );
    for (const [, messages, options] of boundary.requests.mock.calls) {
      if (options.jsonSchema.name === 'class_section_questions') continue;
      const input = JSON.parse(messages[0].content);
      expect(input.lessonContext.teaching).toEqual(sampleTeaching);
      expect(input.lessonContext.grammarPoints).toEqual(['preterite']);
      if (options.jsonSchema.name === 'class_section_quality') {
        expect(input.questions[0].options).toEqual(questions[0].options);
        expect(input.questions[0]).not.toHaveProperty('correctIndex');
      } else expect(input.items[0].content.options).toEqual(questions[0].options);
    }
  });

  it('rejects an answer-leaking task and publishes only its independently reviewed replacement', async () => {
    boundary.leak = true;
    const questions = await generateSectionQuestions(params);
    expect(questions.every(({ question }) => !question.includes('respuesta: visité'))).toBe(true);
    questions.forEach((question, index) =>
      expect(question.options[question.correctIndex]).toBe(authored[index].options[0])
    );
  });
});
