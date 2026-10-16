import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleTeaching } from '../../helpers/learning/class-teaching';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';
import {
  emptyTeachingCriticFixture,
  shapeTeachingProviderFixture,
} from '../classes/quality/intro-provider-fixture';

const boundary = vi.hoisted(() => ({ requests: vi.fn(), leak: false }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (...args: [string, unknown]) => ({
    provider: 'fixture',
    model: 'captured',
    execution: args[1],
  }),
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

import { generateSectionQuestions } from '@/lib/class-generation';
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
  boundary.requests.mockClear();
  boundary.leak = false;
});

describe('assessing the accepted lesson', () => {
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
