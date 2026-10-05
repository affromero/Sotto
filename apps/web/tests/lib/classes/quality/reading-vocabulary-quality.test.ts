import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewReadingVocabularyContent } from '@/lib/classes/quality/reading-vocabulary-quality';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { teachingFailureSchema } from '@/lib/classes/quality/teaching-failure';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import type { AIProvider } from '@/lib/providers/ai';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/learning-ai', () => ({
  capturedLearningAiOptions: async (ai: CapturedLearningAi) => ({
    model: 'captured',
    signal: ai.execution.signal,
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: boundary.info } }));

const metadata = { acceptable: true, issues: [], feedback: [] };
const question = {
  id: 'r1',
  question: 'What does Ana buy?',
  options: ['Apples', 'Bread', 'Soup', 'Tea'],
  correctIndex: 0,
};
const item = {
  lemma: 'Apfel',
  gloss: 'apple',
  pos: 'noun',
  sourceForm: 'Äpfel',
  passageText: 'Ana kauft am Markt Äpfel.',
  questionIndices: [1, 3],
  assessedQuestions: [question, { ...question, id: 'r3' }],
};
const verdict = {
  items: [
    {
      index: 0,
      metadata,
      associations: [
        {
          questionIndex: 3,
          canAnswerWithoutWord: true,
          reasoning: 'The word is incidental to this question.',
        },
        {
          questionIndex: 1,
          canAnswerWithoutWord: false,
          reasoning: 'The object meaning distinguishes the purchased object.',
        },
      ],
    },
  ],
};
const options = () => ({
  ai: {
    provider: 'anthropic' as const,
    model: 'captured',
    execution: { ...blockedProviderExecution('learner'), signal: new AbortController().signal },
  },
  provider: { generateResponse: boundary.generate } as unknown as AIProvider,
  userId: 'learner',
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2',
  items: [structuredClone(item)],
});

beforeEach(() => {
  boundary.generate.mockReset();
  boundary.info.mockReset();
  boundary.generate.mockResolvedValue({ content: JSON.stringify(verdict), model: 'captured' });
});

describe('independent reading vocabulary admission', () => {
  it('retains only explicitly supported links, preserving proposed input and captured request settings', async () => {
    const request = options();
    const original = structuredClone(request.items);
    expect(await reviewReadingVocabularyContent(request)).toEqual([[1]]);
    expect(request.items).toEqual(original);
    const [system, messages, settings] = boundary.generate.mock.calls[0]!;
    expect(JSON.parse(messages[0].content)).toEqual({ items: [{ index: 0, content: item }] });
    expect(settings).toMatchObject({
      model: 'captured',
      temperature: 0,
      maxTokens: 2048,
      signal: request.ai.execution.signal,
      jsonSchema: { name: 'reading_vocabulary_quality' },
    });
    expect(system).toContain('Never reject correct word metadata merely');
    expect(system).toContain('native language at every CEFR level');
    expect(system).toContain('select the supported answer through another fact');
    expect(system).toContain('do not infer mastery of every part');
    expect(boundary.info.mock.calls[0]![1]).toEqual({
      deniedCount: 1,
      denied: [{ batchWordIndex: 0, questionIndex: 3, supported: false }],
      omittedCount: 0,
    });
  });

  it('requires a metadata decision even for words without any proposed mastery association', async () => {
    boundary.generate.mockResolvedValue({
      content: JSON.stringify({ items: [{ index: 0, metadata, associations: [] }] }),
    });
    expect(
      await reviewReadingVocabularyContent({
        ...options(),
        items: [{ ...item, questionIndices: [], assessedQuestions: [] }],
      })
    ).toEqual([[]]);
    expect(JSON.parse(boundary.generate.mock.calls[0]![1][0].content).items[0].content.gloss).toBe(
      'apple'
    );
  });

  it('rejects bad metadata even when every association is denied, retaining the actual typed decision separately', async () => {
    const actual = {
      items: [
        {
          index: 0,
          metadata: {
            acceptable: false,
            issues: ['incorrect'],
            feedback: ['The gloss describes a different object.'],
          },
          associations: item.questionIndices.map((questionIndex) => ({
            questionIndex,
            canAnswerWithoutWord: true,
            reasoning: 'No assessment support.',
          })),
        },
      ],
    };
    boundary.generate.mockResolvedValue({ content: JSON.stringify(actual) });
    const failure = await reviewReadingVocabularyContent(options()).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    const evidence = teachingFailureSchema.parse(
      (failure as TeachingQualityRejectionError).teachingFailure
    );
    expect(evidence.reviews[0]!.verdict).toEqual({
      items: [{ index: 0, ...actual.items[0]!.metadata }],
    });
    expect(JSON.parse(evidence.reviews[0]!.candidate!)[0]).toMatchObject({
      ...item,
      reviewContract: 'reading_metadata_and_associations',
      outerVerdict: 'derived_metadata_only',
      actualReview: actual.items[0],
    });
    expect((failure as TeachingQualityRejectionError).feedback).toEqual([
      { index: 0, feedback: actual.items[0]!.metadata.feedback },
    ]);
    expect(boundary.info).not.toHaveBeenCalled();
  });

  const valid = verdict.items[0]!;
  it.each([
    { label: 'missing word', result: { items: [] } },
    { label: 'duplicate word', result: { items: [valid, valid] } },
    { label: 'invented word', result: { items: [{ ...valid, index: 1 }] } },
    {
      label: 'missing association',
      result: { items: [{ ...valid, associations: [valid.associations[0]] }] },
    },
    {
      label: 'duplicate association',
      result: {
        items: [{ ...valid, associations: [valid.associations[0], valid.associations[0]] }],
      },
    },
    {
      label: 'invented association',
      result: {
        items: [
          {
            ...valid,
            associations: [
              {
                questionIndex: 0,
                canAnswerWithoutWord: false,
                reasoning: 'The answer requires this meaning.',
              },
              valid.associations[0],
            ],
          },
        ],
      },
    },
    {
      label: 'approved metadata with issues',
      result: { items: [{ ...valid, metadata: { ...metadata, issues: ['incorrect'] } }] },
    },
    {
      label: 'rejected metadata without feedback',
      result: {
        items: [{ ...valid, metadata: { acceptable: false, issues: ['incorrect'], feedback: [] } }],
      },
    },
    {
      label: 'counterfactual without a nonempty reason',
      result: {
        items: [
          {
            ...valid,
            associations: valid.associations.map((decision) => ({ ...decision, reasoning: ' ' })),
          },
        ],
      },
    },
    {
      label: 'counterfactual with oversized reasoning',
      result: {
        items: [
          {
            ...valid,
            associations: valid.associations.map((decision) => ({
              ...decision,
              reasoning: 'x'.repeat(301),
            })),
          },
        ],
      },
    },
    {
      label: 'legacy bare support verdict',
      result: {
        items: [
          {
            ...valid,
            associations: [
              { questionIndex: 1, supported: true, feedback: [] },
              { questionIndex: 3, supported: false, feedback: ['Incidental.'] },
            ],
          },
        ],
      },
    },
    { label: 'legacy overloaded word verdict', result: { items: [{ index: 0, ...metadata }] } },
  ])('fails closed on $label without deriving a semantic correction', async ({ result }) => {
    boundary.generate.mockResolvedValue({ content: JSON.stringify(result) });
    await expect(reviewReadingVocabularyContent(options())).rejects.toBeInstanceOf(
      ReviewerProtocolError
    );
    expect(boundary.info).not.toHaveBeenCalled();
  });

  it.each([new Error('Provider transport failed'), new DOMException('Cancelled', 'AbortError')])(
    'propagates the actual provider or cancellation error',
    async (error) => {
      boundary.generate.mockRejectedValue(error);
      await expect(reviewReadingVocabularyContent(options())).rejects.toBe(error);
      expect(boundary.info).not.toHaveBeenCalled();
    }
  );
});
