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
  it('repairs retained inflections and noun articles without changing their source or mastery', async () => {
    const text = 'Der Mechaniker hat das Auto gesehen.';
    const retainedWords = [
      {
        lemma: 'der Mechaniker',
        gloss: 'mechanic',
        pos: 'noun',
        sourceForm: 'Der Mechaniker',
        questionIndices: [],
      },
      {
        lemma: 'gesehen',
        gloss: 'seen',
        pos: 'participle',
        sourceForm: 'gesehen',
        questionIndices: [],
      },
    ];
    boundary.generate.mockImplementation(async (_prompt, messages, request) => {
      const payload = JSON.parse(messages[0].content);
      if (request.jsonSchema.name === 'source_vocabulary_extraction') {
        expect(payload.correction.words).toEqual(retainedWords);
        expect(payload.correction.feedback.map((item: { index: number }) => item.index)).toEqual([
          0, 1,
        ]);
        return {
          model: 'captured',
          content: JSON.stringify({
            words: [
              {
                lemma: 'Mechaniker',
                gloss: 'mechanic',
                pos: 'noun',
                sourceSpan: { startWordIndex: 0, endWordIndex: 1 },
                questionIndices: [],
              },
              {
                lemma: 'sehen',
                gloss: 'see',
                pos: 'verb',
                sourceSpan: { startWordIndex: 5, endWordIndex: 5 },
                questionIndices: [],
              },
            ],
          }),
        };
      }
      return {
        model: 'captured',
        content: JSON.stringify({
          items: payload.items.map((item: { content: { lemma: string } }, index: number) => {
            const valid = ['Mechaniker', 'sehen'].includes(item.content.lemma);
            return {
              index,
              metadata: {
                acceptable: valid,
                issues: valid ? [] : ['incorrect'],
                feedback: valid ? [] : ['Use the canonical lemma and lexical part of speech.'],
              },
              associations: [],
            };
          }),
        }),
      };
    });
    const originalWords = structuredClone(retainedWords);
    expect(
      await extractSourceVocabulary({ ...options, text, sourceFragments: [text], retainedWords })
    ).toEqual([
      { ...retainedWords[0], lemma: 'Mechaniker' },
      { ...retainedWords[1], lemma: 'sehen', gloss: 'see', pos: 'verb' },
    ]);
    expect(retainedWords).toEqual(originalWords);
    expect(boundary.upsert).not.toHaveBeenCalled();
  });

  it('addresses a rejected word in the second batch against the complete retained candidate', async () => {
    const text = 'reisen buchen lernen lesen schreiben gesehen';
    const retainedWords = text.split(' ').map((lemma) => ({
      lemma,
      gloss: 'meaning',
      pos: 'verb',
      sourceForm: lemma,
      questionIndices: [],
    }));
    boundary.generate.mockImplementation(async (_prompt, messages, request) => {
      const payload = JSON.parse(messages[0].content);
      if (request.jsonSchema.name === 'source_vocabulary_extraction') {
        expect(payload.correction.feedback).toEqual([{ index: 5, feedback: ['Use sehen.'] }]);
        return {
          model: 'captured',
          content: JSON.stringify({
            words: retainedWords.map((word, index) => ({
              lemma: index === 5 ? 'sehen' : word.lemma,
              gloss: word.gloss,
              pos: 'verb',
              sourceSpan: { startWordIndex: index, endWordIndex: index },
              questionIndices: [],
            })),
          }),
        };
      }
      return {
        model: 'captured',
        content: JSON.stringify({
          items: payload.items.map((item: { content: { lemma: string } }, index: number) => ({
            index,
            metadata: {
              acceptable: item.content.lemma !== 'gesehen',
              issues: item.content.lemma === 'gesehen' ? ['incorrect'] : [],
              feedback: item.content.lemma === 'gesehen' ? ['Use sehen.'] : [],
            },
            associations: [],
          })),
        }),
      };
    });
    const result = await extractSourceVocabulary({
      ...options,
      text,
      sourceFragments: [text],
      retainedWords,
    });
    expect(result.at(-1)).toMatchObject({ lemma: 'sehen', sourceForm: 'gesehen' });
    expect(result.map((word) => word.sourceForm)).toEqual(
      retainedWords.map((word) => word.sourceForm)
    );
  });

  it('rejects a metadata repair that changes the original quotation', async () => {
    const text = 'gesehen gehen';
    boundary.generate.mockImplementation(async (_prompt, _messages, request) => ({
      model: 'captured',
      content: JSON.stringify(
        request.jsonSchema.name === 'source_vocabulary_extraction'
          ? {
              words: [
                {
                  lemma: 'gehen',
                  gloss: 'go',
                  pos: 'verb',
                  sourceSpan: { startWordIndex: 1, endWordIndex: 1 },
                  questionIndices: [],
                },
              ],
            }
          : {
              items: [
                {
                  index: 0,
                  metadata: { acceptable: false, issues: ['incorrect'], feedback: ['Use sehen.'] },
                  associations: [],
                },
              ],
            }
      ),
    }));
    await expect(
      extractSourceVocabulary({
        ...options,
        text,
        sourceFragments: [text],
        retainedWords: [
          {
            lemma: 'gesehen',
            gloss: 'seen',
            pos: 'participle',
            sourceForm: 'gesehen',
            questionIndices: [],
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'replacement_identity' });
  });

  it('propagates provider failure without attempting metadata repair', async () => {
    const outage = new Error('Selected provider unavailable');
    boundary.generate.mockRejectedValue(outage);
    await expect(
      extractSourceVocabulary({
        ...options,
        retainedWords: [
          { lemma: 'gehen', gloss: 'go', pos: 'verb', sourceForm: 'gegangen', questionIndices: [] },
        ],
      })
    ).rejects.toBe(outage);
    expect(boundary.generate.mock.calls.map((call) => call[2].jsonSchema.name)).toEqual([
      'reading_vocabulary_quality',
    ]);
  });

  it('shares one replacement between malformed extraction and rejected metadata', async () => {
    boundary.generate.mockResolvedValueOnce({ model: 'captured', content: '{' });
    boundary.generate.mockResolvedValueOnce({
      model: 'captured',
      content: JSON.stringify(extracted('schlafen')),
    });
    boundary.generate.mockResolvedValue({
      model: 'captured',
      content: JSON.stringify({
        items: [
          {
            index: 0,
            metadata: {
              acceptable: false,
              issues: ['incorrect'],
              feedback: ['The quotation represents gehen.'],
            },
            associations: [],
          },
        ],
      }),
    });
    await expect(extractSourceVocabulary(options)).rejects.toThrow();
    expect(
      boundary.generate.mock.calls.filter(
        (call) => call[2].jsonSchema.name === 'source_vocabulary_extraction'
      )
    ).toHaveLength(2);
  });

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
