import { describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';
const boundary = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'fixture', model: 'fixture' }),
  capturedLearningAiOptions: async () => ({ model: 'fixture' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import { generateSectionQuestions, type GeneratedQuestion } from '@/lib/class-generation';
import {
  selectVocabularyRepair,
  mergeVocabularyRepair,
} from '@/lib/classes/quality/vocabulary-repair/selection';
import type { SectionReviewFeedback } from '@/lib/classes/section-quality';
import { SectionQualityError } from '@/lib/classes/section-quality';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  skill: 'GRAMMAR' as const,
  vocabularyReview: true,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Understand words in context',
  grammarPoints: [],
  targetVocab: ['gemacht', 'gegangen', 'gesehen', 'besucht', 'gestern'].map((lemma) => ({
    lemma,
    gloss: lemma,
  })),
  seed: 'fixture',
};

describe('bounded selective vocabulary repair', () => {
  it.each([
    { malformed: false, finalReject: false },
    { malformed: true, finalReject: false },
    { malformed: false, finalReject: true },
  ])(
    'preserves four compiled questions but requires full-set acceptance: %j',
    async ({ malformed, finalReject }) => {
      const generationTargets: number[][] = [];
      const blindInputs: Array<Array<{ question: string; options: string[] }>> = [];
      const keyedInputs: unknown[][] = [];
      boundary.generate.mockReset();
      boundary.generate.mockImplementation(
        async (
          system: string,
          messages: Array<{ content: string }>,
          options: {
            jsonSchema: {
              name: string;
              schema: {
                properties: {
                  questions: { items: { properties: { targetIndex: { enum: number[] } } } };
                };
              };
            };
          }
        ) => {
          const name = options.jsonSchema.name;
          expect(system.length).toBeGreaterThan(0);
          let content: unknown;
          if (name === 'class_section_questions') {
            const targets =
              options.jsonSchema.schema.properties.questions.items.properties.targetIndex.enum;
            generationTargets.push(targets);
            if (malformed && generationTargets.length === 2)
              return { content: '{', model: 'fixture' };
            content = {
              passage: '',
              questions: targets.map((targetIndex) => ({
                targetIndex,
                taskContext: 'Choose the complete meaning for this situation.',
                question: `This is ${generationTargets.length === 1 ? 'the first' : 'the revised'} meaningful sentence ${targetIndex}: _____.`,
                distractors: ['anderes', 'nochmals', 'niemals'],
                correctIndex: 0,
                explanation: 'The situation supports this word.',
                passageRef: '',
              })),
            };
          } else {
            const input = JSON.parse(messages[0].content);
            if (name === 'class_section_quality') {
              blindInputs.push(input.questions);
              content = {
                passageFindings: [],
                issues: [],
                questions: [...input.questions.keys()].map((index: number) => ({
                  index,
                  acceptableOptionIndices: [
                    (blindInputs.length === 1 && index === 4) ||
                    (finalReject && blindInputs.length === 2 && index === 0)
                      ? 1
                      : 0,
                  ],
                  issues: [],
                })),
              };
            } else {
              keyedInputs.push(input.items);
              content = {
                items: input.items.map(({ index }: { index: number }) =>
                  name === 'class_teaching_critic'
                    ? { index, findings: [] }
                    : { index, criticDecisions: [], newFindings: [] }
                ),
              };
            }
          }
          return { content: JSON.stringify(content), model: 'fixture' };
        }
      );
      const result = await generateSectionQuestions(params).catch((error: unknown) => {
        expect(error).toBeInstanceOf(SectionQualityError);
        return undefined;
      });
      expect(generationTargets).toEqual(
        malformed ? [[0, 1, 2, 3, 4], [4], [4]] : [[0, 1, 2, 3, 4], [4]]
      );
      expect(blindInputs.map((items) => items.length)).toEqual([5, 5]);
      expect(blindInputs[1].slice(0, 4)).toEqual(blindInputs[0].slice(0, 4));
      expect(blindInputs[1][4].question).toContain('the revised meaningful sentence 4');
      if (finalReject) {
        expect(result).toBeUndefined();
        expect(keyedInputs).toEqual([]);
        return;
      }
      expect(result?.[4].options[0]).toBe('gestern');
      expect(keyedInputs.map((items) => items.length)).toEqual([5, 5]);
    }
  );
  it('selects original target identities and refuses incomplete or global review authority', () => {
    const questions: GeneratedQuestion[] = Array.from({ length: 5 }, (_, index) => ({
      question: `Question ${index}`,
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      explanation: 'A.',
    }));
    const feedback: SectionReviewFeedback = {
      passageAcceptable: true,
      passageFeedback: [],
      issues: [],
      questions: [...questions.keys()].map((index) => ({
        index,
        acceptableOptionIndices: [index === 0 ? 1 : 0],
        issues: [],
      })),
    };
    const selected = selectVocabularyRepair(questions, [4, 3, 2, 1, 0], feedback)!;
    expect(selected.rejectedTargets).toEqual([4]);
    const replaced = { ...questions[0], question: 'Repaired' };
    expect(mergeVocabularyRepair(selected, [replaced], [4])).toEqual([
      replaced,
      ...questions.slice(1),
    ]);
    for (const ids of [[], [0], [4, 4]])
      expect(() => mergeVocabularyRepair(selected, [replaced], ids)).toThrow();
    expect(
      selectVocabularyRepair(questions, [4, 3, 2, 1, 0], { ...feedback, issues: ['uncertain'] })
    ).toBeUndefined();
    expect(
      selectVocabularyRepair(questions, [4, 3, 2, 1, 0], {
        ...feedback,
        questions: feedback.questions.slice(1),
      })
    ).toBeUndefined();
    expect(selectVocabularyRepair(questions, [4, 3, 2, 1, 0], undefined)).toBeUndefined();
  });
});
