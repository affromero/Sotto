import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: boundary.resolve,
  capturedLearningAiOptions: async (ai: { model: string; signal: AbortSignal }) => ({
    model: ai.model,
    signal: ai.signal,
  }),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {}, prismaUnfiltered: {} }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generateSectionQuestions } from '@/lib/class-generation';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  skill: 'GRAMMAR' as const,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Erzähle im Perfekt von einer Reise.',
  grammarPoints: ['Perfekt'],
  targetVocab: [],
  seed: 'speaker-attribution',
};
const questions = [
  {
    question: 'Lea erzählt: „Wir _____ viel zusammen gemacht.“ Ergänze das Perfekt.',
    options: ['haben', 'sind', 'hat', 'seid'],
    correctIndex: 0,
    explanation: '„Machen“ bildet das Perfekt mit „haben“; „wir“ braucht „haben“.',
    passageRef: '',
  },
  {
    question: 'Nora erzählt: „Ich _____ den Film gestern gesehen.“ Ergänze das Perfekt.',
    options: ['habe', 'bin', 'hat', 'sind'],
    correctIndex: 0,
    explanation: '„Sehen“ bildet das Perfekt mit „haben“; „ich“ braucht „habe“.',
    passageRef: '',
  },
  {
    question: 'Tom erzählt: „Ich _____ meine Cousine besucht.“ Ergänze das Perfekt.',
    options: ['habe', 'bin', 'hat', 'seid'],
    correctIndex: 0,
    explanation: '„Besuchen“ bildet das Perfekt mit „haben“; „ich“ braucht „habe“.',
    passageRef: '',
  },
  {
    question: 'Paul erzählt: „Wir _____ nach Hause gegangen.“ Ergänze das Perfekt.',
    options: ['sind', 'haben', 'ist', 'bin'],
    correctIndex: 0,
    explanation: '„Gehen“ bildet das Perfekt mit „sein“; „wir“ braucht „sind“.',
    passageRef: '',
  },
  {
    question: 'Lena erzählt: „Ich _____ ein Foto gemacht.“ Ergänze das Perfekt.',
    options: ['habe', 'bin', 'hat', 'seid'],
    correctIndex: 0,
    explanation: '„Machen“ bildet das Perfekt mit „haben“; „ich“ braucht „habe“.',
    passageRef: '',
  },
];
const unassigned = questions.map((question, index) =>
  index === 1
    ? {
        ...question,
        question: 'Wähle den Perfekt-Satz: Nora erzählt, dass sie den Film gestern gesehen hat.',
        options: [
          'Ich habe den Film gestern gesehen.',
          'Ich bin den Film gestern gesehen.',
          'Ich habe den Film gestern gesieht.',
          'Ich sehe den Film gestern gesehen.',
        ],
      }
    : question
);
const feedback = 'The unquoted first-person answer changes Nora to an unassigned speaker.';
const verdict = (reject: boolean) => ({
  items: questions.map((_, index) => ({
    index,
    acceptable: !(reject && index === 1),
    issues: reject && index === 1 ? ['incorrect'] : [],
    feedback: reject && index === 1 ? [feedback] : [],
  })),
});

beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
  });
});

describe('grammar speaker attribution at the provider boundary', () => {
  it.each(['initial', 'replacement'])(
    'preserves approved quoted subjects in the %s material',
    async (path) => {
      let generated = 0;
      let taught = 0;
      boundary.generate.mockImplementation(async (system, messages, options) => {
        const schema = options.jsonSchema.name;
        if (schema === 'class_section_questions') {
          const candidate = path === 'replacement' && generated++ === 0 ? unassigned : questions;
          expect(system).toContain('subject inside the quotation determines its agreement');
          if (candidate === questions && path === 'replacement') {
            expect(messages[0].content).toContain(feedback);
            expect(messages[0].content).toContain('Do not change a valid quoted subject');
            expect(messages[0].content).toContain('preserve the stated actor and facts');
          }
          return { content: JSON.stringify({ passage: '', questions: candidate }) };
        }
        if (schema === 'class_section_quality') {
          expect(system).toContain('Independently solve each question');
          expect(system).toContain('Do not require a quoted subject to match');
          const input = JSON.parse(messages[0].content);
          expect(input.questions.every((item: object) => !('correctIndex' in item))).toBe(true);
          expect(input.questions.every((item: object) => !('explanation' in item))).toBe(true);
          return {
            content: JSON.stringify({
              passageAcceptable: true,
              issues: [],
              questions: input.questions.map((item: { index: number }) => ({
                index: item.index,
                acceptableOptionIndices: [0],
                issues: [],
              })),
            }),
          };
        }
        expect(schema).toBe('class_teaching_quality');
        expect(system).toContain('For explanation items involving grammar tasks');
        expect(system).toContain('Reject unquoted transformations that change the stated actor');
        const reject = path === 'replacement' && taught++ === 0;
        expect(
          JSON.parse(messages[0].content).items.map((item: { content: object }) => item.content)
        ).toEqual(reject ? unassigned : questions);
        return { content: JSON.stringify(verdict(reject)) };
      });
      const result = await generateSectionQuestions(params);
      expect(result).toEqual(questions);
      expect(result[0]?.question).toContain('Wir');
      expect(result[1]?.question).toContain('Nora erzählt: „Ich');
    }
  );

  it.each(['blind', 'keyed'])(
    'rejects material when its %s review finds an unassigned actor in both candidates',
    async (stage) => {
      boundary.generate.mockImplementation(async (system, messages, options) => {
        if (options.jsonSchema.name === 'class_section_questions') {
          expect(system).toContain('An unquoted transformation must preserve the stated actor');
          expect(messages[0].content).toContain('Generate 5 grammar questions');
          return { content: JSON.stringify({ passage: '', questions: unassigned }) };
        }
        if (options.jsonSchema.name === 'class_section_quality') {
          expect(system).toContain('Reject unquoted transformations that change the stated actor');
          const input = JSON.parse(messages[0].content);
          expect(input.questions[1].question).toEqual(unassigned[1]?.question);
          expect(input.questions.every((item: object) => !('correctIndex' in item))).toBe(true);
          expect(input.questions.every((item: object) => !('explanation' in item))).toBe(true);
          return {
            content: JSON.stringify({
              passageAcceptable: true,
              issues: [],
              questions: questions.map((_, index) => ({
                index,
                acceptableOptionIndices: stage === 'blind' && index === 1 ? [] : [0],
                issues: stage === 'blind' && index === 1 ? ['incorrect'] : [],
              })),
            }),
          };
        }
        expect(stage).toBe('keyed');
        expect(options.jsonSchema.name).toBe('class_teaching_quality');
        expect(system).toContain('For explanation items involving grammar tasks');
        expect(JSON.parse(messages[0].content).items[1].content).toEqual(unassigned[1]);
        return { content: JSON.stringify(verdict(true)) };
      });
      const failure = await generateSectionQuestions(params).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SectionQualityError);
      if (stage === 'blind') {
        expect(failure).not.toBeInstanceOf(TeachingQualityRejectionError);
        return;
      }
      if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
      expect(failure.feedback).toEqual([{ index: 1, feedback: [feedback] }]);
      expect(failure.teachingFailure?.reviews.map((review) => review.verdict)).toEqual([
        verdict(true),
        verdict(true),
      ]);
      for (const review of failure.teachingFailure?.reviews ?? [])
        expect(JSON.parse(review.candidate!)[1]).toEqual(unassigned[1]);
    }
  );
});
