// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SECTION_QUALITY_JSON_SCHEMA } from '@/lib/classes/section-quality';
import { TEACHING_QUALITY_JSON_SCHEMA } from '@/lib/classes/quality/teaching-quality';
import { generateSectionQuestions } from '@/lib/class-generation';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';

const execute = vi.hoisted(() => vi.fn());
vi.mock('@/lib/codex-client', () => ({ executeCodex: execute }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'codex', model: 'fixture-model' }),
  capturedLearningAiOptions: async () => ({ model: 'fixture-model' }),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {}, prismaUnfiltered: {} }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('section review through the Codex provider', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('delivers the canonical verdict schema in the CLI prompt and validates its response', async () => {
    const question = {
      question: 'Al llegar, Ana dice _____ a sus amigos.',
      options: ['hola', 'mesa', 'libro', 'agua'],
      correctIndex: 0,
      explanation: 'Hola is a greeting.',
    };
    execute.mockImplementation(async (system: string, user: string) => {
      if (system.includes('teaching content for')) {
        expect(JSON.parse(/```json\s*([\s\S]*?)\s*```/.exec(system)![1])).toEqual(
          TEACHING_QUALITY_JSON_SCHEMA.schema
        );
        expect(user).toContain(question.explanation);
        return {
          content: JSON.stringify({
            items: [{ index: 0, acceptable: true, issues: [], feedback: [] }],
          }),
          model: 'fixture-model',
        };
      }
      if (!system.includes('independently evaluate')) {
        return {
          content: JSON.stringify({ passage: '', questions: [question] }),
          inputTokens: 1,
          outputTokens: 1,
          model: 'fixture-model',
        };
      }
      const schemaBlock = /```json\s*([\s\S]*?)\s*```/.exec(system);
      expect(schemaBlock).not.toBeNull();
      expect(JSON.parse(schemaBlock![1])).toEqual(SECTION_QUALITY_JSON_SCHEMA.schema);
      expect(user).toContain(question.question);
      expect(user).not.toContain('correctIndex');
      expect(user).not.toContain(question.explanation);
      return {
        content: JSON.stringify({
          passageAcceptable: true,
          issues: [],
          questions: [{ index: 0, acceptableOptionIndices: [0], issues: [] }],
        }),
        inputTokens: 1,
        outputTokens: 1,
        model: 'fixture-model',
      };
    });
    const result = await generateSectionQuestions({
      userId: 'learner',
      execution: blockedProviderExecution('learner'),
      skill: 'GRAMMAR',
      vocabularyReview: true,
      level: 'A1',
      nativeLang: 'en',
      targetLang: 'es',
      objective: 'Greet friends',
      grammarPoints: [],
      targetVocab: [{ lemma: 'hola', gloss: 'hello' }],
      seed: 'fixture',
    });
    expect(result).toEqual([expect.objectContaining(question)]);
    expect(
      execute.mock.calls.some(([system]) => String(system).includes('Required output JSON Schema:'))
    ).toBe(true);
  });
});
