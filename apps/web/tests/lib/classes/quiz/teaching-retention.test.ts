import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({
    provider: 'fixture',
    model: 'fixture',
  }),
  capturedLearningAiOptions: async () => ({ model: 'fixture' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateSectionQuestions, type GeneratedQuestion } from '@/lib/class-generation';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';

const lemmas = ['gemacht', 'gegangen', 'gesehen', 'besucht', 'gestern'];
const sentences = [
  'Mila hat gestern eine Reise _____.',
  'Leon ist gestern zu Fuß nach Hause _____.',
  'Lea hat gestern einen Film _____.',
  'Noah hat gestern seine Tante _____.',
  '_____ war Montag; heute ist Dienstag.',
];
const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  skill: 'GRAMMAR' as const,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Use completed actions and time expressions correctly.',
  grammarPoints: ['Perfekt'],
  targetVocab: lemmas.map((lemma) => ({ lemma, gloss: lemma })),
  seed: 'teaching-retention',
};
type ReviewItem = {
  index: number;
  content: GeneratedQuestion;
  sourceParts: Array<{ index: number; fieldPath: string[]; quote: string }>;
};
type BlindItem = {
  index: number;
  question: string;
  options: string[];
  completedOptions: string[];
};
type Request = { name: string; items: ReviewItem[] };
let requests: Request[];
let blindInputs: BlindItem[][];
let malformed: boolean;
let finalReject: boolean;
let vocabulary: boolean;
let generated: boolean;

function authored(replacement: boolean) {
  const rows = sentences.map((question, targetIndex) => ({
    targetIndex,
    taskContext: replacement
      ? 'Wähle das Wort für die neue Situation.'
      : 'Ergänze das passende Wort.',
    question:
      replacement && targetIndex === 4
        ? 'Am Tag vor heute, also _____, war Montag.'
        : replacement
          ? question.replace('gestern', 'am Montag')
          : question,
    distractors: ['getrunken', 'gegessen', 'geschrieben'],
    correctIndex: replacement && targetIndex !== 4 ? 2 : 0,
    explanation:
      replacement && targetIndex === 4 && finalReject
        ? 'Gestern ist der Tag nach heute.'
        : `Die Situation verlangt „${lemmas[targetIndex]}“.`,
    passageRef: '',
  }));
  if (replacement && malformed) rows[0].explanation = '';
  if (vocabulary) return replacement ? rows.reverse() : rows;
  return rows.map(({ targetIndex, distractors, correctIndex, ...row }) => {
    const options = [...distractors];
    options.splice(correctIndex, 0, lemmas[targetIndex]);
    return { ...row, correctIndex, options };
  });
}

beforeEach(() => {
  requests = [];
  blindInputs = [];
  malformed = false;
  finalReject = false;
  generated = false;
  boundary.generate.mockReset();
  boundary.generate.mockImplementation(
    async (
      _system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema: { name: string } }
    ) => {
      const name = options.jsonSchema.name;
      if (name === 'class_section_questions') {
        const questions = authored(generated);
        generated = true;
        return {
          content: JSON.stringify({ passage: '', questions }),
          model: 'fixture',
        };
      }
      const input = JSON.parse(messages[0].content);
      if (name === 'class_section_quality') {
        blindInputs.push(input.questions);
        return {
          content: JSON.stringify({
            passageFindings: [],
            issues: [],
            questions: input.questions.map((question: BlindItem) => ({
              index: question.index,
              acceptableOptionIndices: [
                question.options.findIndex((option) => lemmas.includes(option)),
              ],
              issues: [],
            })),
          }),
          model: 'fixture',
        };
      }
      requests.push({ name, items: input.items });
      const items = input.items as ReviewItem[];
      return {
        content: JSON.stringify({
          items: items.map((item) => {
            if (name === 'class_teaching_critic') {
              const initial = item.content.question.endsWith(sentences[4]);
              const incorrect = item.content.explanation === 'Gestern ist der Tag nach heute.';
              const source = item.sourceParts.find(
                (part) => part.fieldPath[0] === (initial ? 'question' : 'explanation')
              );
              return {
                index: item.index,
                findings:
                  initial || incorrect
                    ? [
                        {
                          sourcePartIndex: source!.index,
                          issue: 'incorrect',
                          rule: initial
                            ? 'German sentence-initial words require capitalization.'
                            : 'Gestern denotes the day before today.',
                          defect: initial
                            ? 'The keyed completion starts a sentence with lowercase gestern.'
                            : 'The explanation incorrectly places yesterday after today.',
                          remedy: {
                            kind: 'correction',
                            text: initial
                              ? 'Am Tag vor heute, also gestern, war Montag.'
                              : 'Gestern ist der Tag vor heute.',
                          },
                        },
                      ]
                    : [],
              };
            }
            const findings = input.criticisms.items.find(
              (critic: { index: number }) => critic.index === item.index
            ).findings;
            return {
              index: item.index,
              criticDecisions: findings.map((_: unknown, findingIndex: number) => ({
                findingIndex,
                decision: 'supported',
                reason: 'The literal completion or explanation contains the stated defect.',
              })),
              newFindings: [],
            };
          }),
        }),
        model: 'fixture',
      };
    }
  );
});

describe('authenticated whole-question teaching repair', () => {
  it.each([false, true])(
    'preserves approved grammar or vocabulary questions through complete fresh review: vocabulary=%s',
    async (vocabularyReview) => {
      vocabulary = vocabularyReview;
      const result = await generateSectionQuestions({
        ...params,
        vocabularyReview,
      });
      const initial = requests.find(({ name }) => name === 'class_teaching_critic')!.items;
      const final = requests.filter(({ name }) => name === 'class_teaching_critic').at(-1)!.items;
      for (const original of initial.slice(0, 4)) {
        const key = original.content.options[original.content.correctIndex];
        const retained = result.find(
          (question) => question.options[question.correctIndex] === key
        )!;
        expect(retained).toEqual(original.content);
        const blind = blindInputs.at(-1)!.find((question) => question.options.includes(key))!;
        expect(blind).toEqual({
          ...blindInputs[0][original.index],
          index: blind.index,
        });
        for (const review of requests.filter(({ name }) => name.startsWith('class_teaching_'))) {
          const item = review.items.find((row) => row.content.options.includes(key))!;
          expect(item.content).toEqual(original.content);
        }
      }
      const corrected = result.find(
        (question) => question.options[question.correctIndex] === 'gestern'
      )!;
      expect(corrected.question).toContain('Am Tag vor heute, also _____, war Montag.');
      expect(final.find((item) => item.content.options.includes('gestern'))!.content).toEqual(
        corrected
      );
    }
  );

  it('keeps a genuine second teaching defect terminal after preserving approved questions', async () => {
    vocabulary = true;
    finalReject = true;
    const error = await generateSectionQuestions({
      ...params,
      vocabularyReview: true,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    expect((error as TeachingQualityRejectionError).issues).toContain('incorrect');
    const initial = requests.find(({ name }) => name === 'class_teaching_critic')!.items;
    const final = requests.filter(({ name }) => name === 'class_teaching_critic').at(-1)!.items;
    expect(
      final.find((item) => item.content.options.includes('gestern'))!.content.explanation
    ).toBe('Gestern ist der Tag nach heute.');
    for (const original of initial.slice(0, 4))
      expect(
        final.find((item) => item.content.question === original.content.question)!.content
      ).toEqual(original.content);
  });

  it('rejects an invalid complete replacement even when its malformed row was previously approved', async () => {
    vocabulary = true;
    malformed = true;
    await expect(generateSectionQuestions({ ...params, vocabularyReview: true })).rejects.toThrow();
    for (const request of requests)
      expect(
        request.items.find((item) => item.content.options.includes('gestern'))!.content.question
      ).toContain(sentences[4]);
    for (const questions of blindInputs)
      expect(
        questions.find((question) => question.options.includes('gestern'))!.question
      ).toContain(sentences[4]);
  });
});
