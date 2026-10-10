/**
 * Unit tests for src/lib/class-generation.ts.
 * Verifies MCQ generation and that READING sections carry a full passage:
 * generated for curriculum classes, sourced from {{SOURCE}} for sourced classes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  emptyTeachingCriticFixture,
  novelFindingCorroborationFixture,
  shapeTeachingProviderFixture,
} from './intro-provider-fixture';

const mockResolveLearningAi = vi.fn();
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a),
  capturedLearningAiOptions: async (ai: {
    model: string;
    apiKey?: string;
    signal?: AbortSignal;
    authenticatedFetch?: typeof fetch;
  }) => ({
    model: ai.model,
    apiKeyOverride: ai.apiKey,
    signal: ai.signal,
    fetch: ai.authenticatedFetch,
  }),
}));

const mockGenerateResponse = vi.fn();
const mockReviewResponse = vi.fn();
const mockTeachingResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: unknown
    ) => {
      const corroboration = novelFindingCorroborationFixture(messages, options);
      if (corroboration) return corroboration;
      const name = (options as { jsonSchema: { name: string } }).jsonSchema.name;
      if (name === 'class_teaching_critic') return emptyTeachingCriticFixture(messages, options);
      if (name === 'class_teaching_adjudicator')
        return shapeTeachingProviderFixture(
          system,
          messages,
          options,
          await mockTeachingResponse(system, messages, options)
        );
      return name === 'class_section_quality'
        ? mockReviewResponse(system, messages, options)
        : mockGenerateResponse(system, messages, options);
    },
  }),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {}, prismaUnfiltered: {} }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generateSectionQuestions } from '@/lib/class-generation';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import type { SectionGenParams } from '@/lib/class-generation';
import type { SkillType } from '@sotto/shared';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';
import {
  SAMPLE_QUESTIONS,
  SAMPLE_SECTION_RESPONSE as SAMPLE,
} from '../../../helpers/runtime/section-generation';

const BASE: SectionGenParams = {
  userId: 'u1',
  execution: blockedProviderExecution('u1'),
  skill: 'READING' as SkillType,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Read a short article',
  grammarPoints: ['past tense'],
  targetVocab: [{ lemma: 'descubrir', gloss: 'to discover' }],
  seed: 'class-1-READING-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLearningAi.mockResolvedValue({
    provider: 'anthropic',
    model: 'm',
    apiKey: 'k',
    execution: BASE.execution,
  });
  mockTeachingResponse.mockImplementation(async (_system, messages) => ({
    content: JSON.stringify({
      items: JSON.parse(messages[0].content).items.map((item: { index: number }) => ({
        index: item.index,
        acceptable: true,
        issues: [],
        feedback: [],
      })),
    }),
    model: 'm',
  }));
  mockReviewResponse.mockImplementation(async (_system, messages) => ({
    content: JSON.stringify({
      passageFindings: [],
      issues: [],
      questions: JSON.parse(messages[0].content).questions.map((q: { index: number }) => ({
        index: q.index,
        acceptableOptionIndices: [q.index === 1 ? 1 : 0],
        issues: [],
      })),
    }),
    model: 'm',
    inputTokens: 1,
    outputTokens: 1,
  }));
  mockGenerateResponse.mockResolvedValue({
    content: SAMPLE,
    inputTokens: 10,
    outputTokens: 20,
    model: 'm',
  });
});

describe('terminal section generation failures', () => {
  it('fails closed after a repaired candidate also fails teaching review', async () => {
    mockGenerateResponse
      .mockResolvedValueOnce({ content: SAMPLE })
      .mockResolvedValueOnce({ content: '{' })
      .mockResolvedValueOnce({ content: SAMPLE });
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({
        items: SAMPLE_QUESTIONS.map((_, index) => ({
          index,
          acceptable: false,
          issues: ['unnatural'],
          feedback: ['The explanation teaches an incorrect collocation.'],
        })),
      }),
      model: 'm',
    });

    const error = await generateSectionQuestions(BASE).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error.teachingFailure?.reviews).toHaveLength(2);
    expect(
      error.teachingFailure?.reviews.map((review) => JSON.parse(review.candidate!)[0].items)
    ).toEqual(
      mockTeachingResponse.mock.calls.map((call) =>
        JSON.parse(call[1][0].content).items.map((item: { content: unknown }) => item.content)
      )
    );
    expect(mockGenerateResponse).toHaveBeenCalledTimes(3);
    expect(mockReviewResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
  });

  it.each(['malformed', 'blind'])(
    'keeps the final %s failure separate from earlier teaching feedback',
    async (kind) => {
      mockTeachingResponse.mockResolvedValue({
        content: JSON.stringify({
          items: SAMPLE_QUESTIONS.map((_, index) => ({
            index,
            acceptable: false,
            issues: ['incorrect'],
            feedback: ['Private earlier teaching feedback.'],
          })),
        }),
        model: 'm',
      });
      if (kind === 'malformed') {
        mockGenerateResponse
          .mockResolvedValueOnce({ content: SAMPLE })
          .mockResolvedValue({ content: '{' });
      } else {
        mockReviewResponse
          .mockImplementationOnce(async (_system, messages) => ({
            content: JSON.stringify({
              passageFindings: [],
              issues: [],
              questions: JSON.parse(messages[0].content).questions.map((q: { index: number }) => ({
                index: q.index,
                acceptableOptionIndices: [q.index === 1 ? 1 : 0],
                issues: [],
              })),
            }),
            model: 'm',
          }))
          .mockResolvedValue({
            content: JSON.stringify({
              passageFindings: [],
              issues: ['ambiguous'],
              questions: SAMPLE_QUESTIONS.map((_, index) => ({
                index,
                acceptableOptionIndices: [0, 1],
                issues: ['ambiguous'],
              })),
            }),
            model: 'm',
          });
      }
      const error = await generateSectionQuestions(BASE).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(SectionQualityError);
      expect(error).not.toBeInstanceOf(TeachingQualityRejectionError);
      expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
    }
  );
});
