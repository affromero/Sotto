import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractSourceVocabulary } from '@/lib/learning/reading-vocabulary';
import { buildReadingVocabularyWordTable } from '@/lib/learning/reading/vocabulary-protocol';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'anthropic', model: 'captured' }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { learnerVocab: { upsert: boundary.upsert } },
  prismaUnfiltered: { learnerVocab: { upsert: boundary.upsert } },
}));
const fragment = 'Mia ist gestern nach Hause gegangen.';
const options = {
  userId: 'learner',
  execution: blockedProviderExecution('learner'),
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2',
  text: `Document "Vocab Deutsch.pdf"\n[tail: code points 50000..50038]\n${fragment}`,
  sourceFragments: [fragment],
  preferredLemmas: ['gehen'],
};
function extracted(lemma = 'gehen', questionIndices: number[] = []) {
  const index = buildReadingVocabularyWordTable(options.text, 'de').findIndex(
    ({ surface }) => surface === 'gegangen'
  );
  return {
    words: [
      {
        lemma,
        gloss: 'go',
        pos: 'verb',
        sourceSpan: { startWordIndex: index, endWordIndex: index },
        questionIndices,
      },
    ],
  };
}
const approved = {
  items: [{ index: 0, metadata: { acceptable: true, issues: [], feedback: [] }, associations: [] }],
};
beforeEach(() => {
  vi.clearAllMocks();
  boundary.generate.mockImplementation(async (_prompt, _messages, request) => ({
    content: JSON.stringify(
      request.jsonSchema.name === 'source_vocabulary_extraction' ? extracted() : approved
    ),
    model: 'captured',
  }));
});
describe('source vocabulary evidence', () => {
  it('admits an independently reviewed inflection without inventing assessments or writing mastery', async () => {
    expect(await extractSourceVocabulary(options)).toEqual([
      { lemma: 'gehen', gloss: 'go', pos: 'verb', sourceForm: 'gegangen', questionIndices: [] },
    ]);
    const review = boundary.generate.mock.calls.find(
      (call) => call[2].jsonSchema.name === 'reading_vocabulary_quality'
    )!;
    expect(review[0]).toContain('original languages');
    expect(JSON.parse(review[1][0].content).items[0].content).toMatchObject({
      lemma: 'gehen',
      sourceQuote: 'gegangen',
      assessedQuestions: [],
      questionIndices: [],
    });
    expect(boundary.upsert).not.toHaveBeenCalled();
  });
  it('rejects an unrelated lemma through canonical metadata review', async () => {
    boundary.generate.mockImplementation(async (_prompt, _messages, request) => ({
      content: JSON.stringify(
        request.jsonSchema.name === 'source_vocabulary_extraction'
          ? extracted('schlafen')
          : {
              items: [
                {
                  index: 0,
                  metadata: {
                    acceptable: false,
                    issues: ['incorrect'],
                    feedback: ['Gehen is represented by gegangen; schlafen is unrelated.'],
                  },
                  associations: [],
                },
              ],
            }
      ),
      model: 'captured',
    }));
    await expect(extractSourceVocabulary(options)).rejects.toThrow();
    expect(boundary.upsert).not.toHaveBeenCalled();
  });
  it('rejects invented assessment associations before metadata admission', async () => {
    boundary.generate.mockResolvedValue({
      content: JSON.stringify(extracted('gehen', [0])),
      model: 'captured',
    });
    await expect(extractSourceVocabulary(options)).rejects.toThrow('attribution');
    expect(
      boundary.generate.mock.calls.every(
        (call) => call[2].jsonSchema.name === 'source_vocabulary_extraction'
      )
    ).toBe(true);
  });
  it('rejects a filename quotation that is absent from the actual source fragments', async () => {
    boundary.generate.mockResolvedValue({
      content: JSON.stringify({
        words: [
          {
            lemma: 'Dokument',
            gloss: 'document',
            pos: 'noun',
            sourceSpan: { startWordIndex: 0, endWordIndex: 0 },
            questionIndices: [],
          },
        ],
      }),
      model: 'captured',
    });
    await expect(extractSourceVocabulary(options)).rejects.toThrow('attribution');
  });
  it('does not accept a clipped suchen suffix because an intact besuchen occurs elsewhere', async () => {
    boundary.generate.mockResolvedValue({
      content: JSON.stringify({
        words: [
          {
            lemma: 'suchen',
            gloss: 'search',
            pos: 'verb',
            sourceSpan: { startWordIndex: 0, endWordIndex: 0 },
            questionIndices: [],
          },
        ],
      }),
      model: 'captured',
    });
    await expect(
      extractSourceVocabulary({ ...options, text: 'suchen', sourceFragments: ['besuchen'] })
    ).rejects.toThrow('attribution');
  });
  it('rejects oversized source context before contacting the provider', async () => {
    await expect(extractSourceVocabulary({ ...options, text: 'a'.repeat(12001) })).rejects.toThrow(
      'limit'
    );
    expect(boundary.generate).not.toHaveBeenCalled();
  });
});
