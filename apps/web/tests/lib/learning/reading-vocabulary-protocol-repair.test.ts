import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractReadingVocabulary } from '@/lib/learning/reading-vocabulary';
import { ReadingVocabularyProtocolError } from '@/lib/learning/reading/vocabulary-protocol';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';

const generate = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'anthropic', model: 'captured' }),
  capturedLearningAiOptions: async () => ({ model: 'captured' }),
}));
vi.mock('@/lib/providers/ai', () => ({ createAIProvider: () => ({ generateResponse: generate }) }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

const word = {
  lemma: 'bestellen',
  gloss: 'to order',
  pos: 'verb',
  sourceForm: 'bestellt',
  questionIndices: [],
};
const wireWord = {
  lemma: 'bestellen',
  gloss: 'to order',
  pos: 'verb',
  sourceSpan: { startWordIndex: 1, endWordIndex: 1 },
  questionIndices: [],
};
const question = {
  id: 'reading-1',
  question: 'What does Ana order?',
  options: ['Coffee', 'Tea', 'Milk', 'Water'],
  correctIndex: 0,
  passageText: 'Ana bestellt Kaffee.',
};
const options = {
  userId: 'learner',
  execution: blockedProviderExecution('learner'),
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2',
  questions: [question],
};
const response = (content: unknown) => ({ content: JSON.stringify(content), model: 'captured' });
const verdict = (acceptable: boolean) => ({
  items: [
    {
      index: 0,
      metadata: {
        acceptable,
        issues: acceptable ? [] : ['incorrect'],
        feedback: acceptable ? [] : ['The gloss does not match the source verb.'],
      },
      associations: [],
    },
  ],
});
beforeEach(() => {
  generate.mockReset();
  logError.mockReset();
});

describe('bounded reading vocabulary protocol repair', () => {
  it.each([
    { raw: 'not JSON', code: 'malformed_json' },
    { raw: JSON.stringify([wireWord]), code: 'invalid_shape' },
    {
      raw: JSON.stringify({
        words: [{ ...wireWord, sourceSpan: { startWordIndex: 3, endWordIndex: 3 } }],
      }),
      code: 'source_attribution',
    },
  ])(
    'repairs $code and reviews the complete replacement before returning it',
    async ({ raw, code }) => {
      generate
        .mockResolvedValueOnce({ content: raw, model: 'captured' })
        .mockResolvedValueOnce(response({ words: [wireWord] }))
        .mockResolvedValueOnce(response(verdict(true)));
      const result = await extractReadingVocabulary(options);
      expect(result.words).toEqual([
        {
          lemma: 'bestellen',
          gloss: 'to order',
          pos: 'verb',
          sourceForm: 'bestellt',
          questionIds: [],
        },
      ]);
      const repair = JSON.parse(generate.mock.calls[1]![1][0].content);
      expect(repair).toMatchObject({
        passageText: question.passageText,
        protocolCorrection: { rawCandidate: raw, code },
      });
      expect(repair).not.toHaveProperty('correction');
      const review = JSON.parse(generate.mock.calls[2]![1][0].content);
      expect(review.items[0].content).toMatchObject({ ...word, passageText: question.passageText });
      expect(JSON.stringify(logError.mock.calls)).not.toContain(raw);
    }
  );

  it('corrects a tenth invalid span without preserving invalid prior identities or counts', async () => {
    const words = Array.from({ length: 10 }, (_, index) => ({
      ...wireWord,
      lemma: `word${index}`,
      sourceSpan: index === 9 ? { startWordIndex: 3, endWordIndex: 3 } : wireWord.sourceSpan,
    }));
    generate
      .mockResolvedValueOnce(response({ words }))
      .mockResolvedValueOnce(response({ words: [wireWord] }))
      .mockResolvedValueOnce(response(verdict(true)));
    expect((await extractReadingVocabulary(options)).words).toHaveLength(1);
    expect(JSON.parse(generate.mock.calls[1]![1][0].content).protocolCorrection).toMatchObject({
      code: 'source_attribution',
      violations: [{ code: 'invalid_source_span', wordIndex: 9 }],
    });
    expect(logError.mock.calls[0]![1].attributionViolations).toEqual([
      { code: 'invalid_source_span', wordIndex: 9 },
    ]);
  });

  it.each([
    { words: [{ ...wireWord, sourceSpan: { startWordIndex: 3, endWordIndex: 3 } }] },
    { words: [wireWord, wireWord] },
    { words: [{ ...wireWord, questionIndices: [1] }] },
    { words: [{ ...wireWord, questionIndices: [0, 0] }] },
    { words: [] },
    { words: [{ ...wireWord, sourceSpan: { startWordIndex: 2, endWordIndex: 1 } }] },
    { words: [{ ...wireWord, sourceSpan: { startWordIndex: 1.5, endWordIndex: 2 } }] },
    { words: [{ ...wireWord, sourceSpan: { startWordIndex: -1, endWordIndex: 1 } }] },
    { words: [word] },
  ])('rejects an invalid replacement without a third extraction: %j', async (replacement) => {
    generate
      .mockResolvedValueOnce({ content: 'malformed original', model: 'captured' })
      .mockResolvedValueOnce(response(replacement));
    await expect(extractReadingVocabulary(options)).rejects.toBeInstanceOf(
      ReadingVocabularyProtocolError
    );
    expect(generate.mock.calls.map((call) => call[2].jsonSchema.name)).toEqual([
      'reading_vocabulary_extraction',
      'reading_vocabulary_extraction',
    ]);
  });

  it('stops on teaching rejection after protocol repair instead of extracting a third candidate', async () => {
    generate
      .mockResolvedValueOnce({ content: 'invalid original', model: 'captured' })
      .mockResolvedValueOnce(response({ words: [wireWord] }))
      .mockResolvedValueOnce(response(verdict(false)));
    const failure = await extractReadingVocabulary(options).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(failure.teachingFailure?.reviews[0]?.verdict.items[0]).toMatchObject({
      acceptable: false,
      issues: ['incorrect'],
    });
    expect(generate.mock.calls.map((call) => call[2].jsonSchema.name)).toEqual([
      'reading_vocabulary_extraction',
      'reading_vocabulary_extraction',
      'reading_vocabulary_quality',
    ]);
  });

  it('rejects oversized invalid output without redispatching or leaking its contents', async () => {
    const raw = 'private invalid output'.repeat(2000);
    generate.mockResolvedValueOnce({ content: raw, model: 'captured' });
    await expect(extractReadingVocabulary(options)).rejects.toThrow('bounded metadata');
    expect(generate.mock.calls).toHaveLength(1);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('private invalid output');
  });

  it.each(['initial extraction', 'protocol replacement', 'replacement review'])(
    'propagates cancellation at %s without another extraction',
    async (stage) => {
      const abort = new DOMException('Cancelled by learner', 'AbortError');
      if (stage !== 'initial extraction')
        generate.mockResolvedValueOnce({ content: 'invalid original', model: 'captured' });
      if (stage === 'replacement review')
        generate.mockResolvedValueOnce(response({ words: [wireWord] }));
      generate.mockRejectedValueOnce(abort);
      await expect(extractReadingVocabulary(options)).rejects.toBe(abort);
      expect(generate.mock.calls).toHaveLength(
        stage === 'initial extraction' ? 1 : stage === 'protocol replacement' ? 2 : 3
      );
    }
  );

  it('does not reinterpret a provider-thrown protocol error as a parsed output defect', async () => {
    const failure = new ReadingVocabularyProtocolError('invalid_shape');
    generate.mockRejectedValueOnce(failure);
    await expect(extractReadingVocabulary(options)).rejects.toBe(failure);
    expect(generate.mock.calls).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([
    {
      passageText: 'Gestern bin ich zu Fuß zum Markt gegangen.',
      targetLang: 'de',
      span: [3, 4],
      expected: 'zu Fuß',
    },
    { passageText: 'Ich rufe meine Tante an.', targetLang: 'de', span: [1, 1], expected: 'rufe' },
    {
      passageText: 'Ich rufe meine Tante an.',
      targetLang: 'de',
      span: [1, 4],
      expected: 'rufe meine Tante an',
    },
    { passageText: '我昨天去了市场。', targetLang: 'zh', span: [0, 3], expected: '我昨天去了市场' },
    {
      passageText: '😀 Café,  e\u0301té!',
      targetLang: 'fr',
      span: [0, 1],
      expected: 'Café,  e\u0301té',
    },
  ])(
    'derives the exact original contiguous quote $expected without storing positions',
    async ({ passageText, targetLang, span, expected }) => {
      generate
        .mockResolvedValueOnce(
          response({
            words: [
              { ...wireWord, sourceSpan: { startWordIndex: span[0], endWordIndex: span[1] } },
            ],
          })
        )
        .mockResolvedValueOnce(response(verdict(true)));
      const result = await extractReadingVocabulary({
        ...options,
        targetLang,
        questions: [{ ...question, passageText }],
      });
      expect(result.words[0]?.sourceForm).toBe(expected);
      expect(result.words[0]).not.toHaveProperty('sourceSpan');
      expect(JSON.parse(generate.mock.calls[1]![1][0].content).items[0].content.sourceForm).toBe(
        expected
      );
    }
  );

  it('cannot copy an option-only verb through the private quote field', async () => {
    const readingQuestion = {
      ...question,
      options: ['vergessen', 'bestellen', 'besuchen', 'gehen'],
    };
    generate
      .mockResolvedValueOnce(response({ words: [{ ...word, sourceForm: 'vergessen' }] }))
      .mockResolvedValueOnce(response({ words: [wireWord] }))
      .mockResolvedValueOnce(response(verdict(true)));
    const result = await extractReadingVocabulary({ ...options, questions: [readingQuestion] });
    expect(result.words[0]?.sourceForm).toBe('bestellt');
    const request = JSON.parse(generate.mock.calls[0]![1][0].content);
    expect(request.passageWords).toEqual([
      { index: 0, surface: 'Ana' },
      { index: 1, surface: 'bestellt' },
      { index: 2, surface: 'Kaffee' },
    ]);
    expect(JSON.stringify(request.passageWords)).not.toContain('vergessen');
    expect(logError.mock.calls[0]![1].code).toBe('invalid_shape');
  });

  it.each([
    { passageText: '😀...!', targetLang: 'de' },
    { passageText: 'Ana bestellt Kaffee.', targetLang: 'zz' },
    { passageText: 'x'.repeat(12001), targetLang: 'de' },
  ])(
    'refuses unusable passage segmentation before provider admission: %j',
    async ({ passageText, targetLang }) => {
      await expect(
        extractReadingVocabulary({
          ...options,
          targetLang,
          questions: [{ ...question, passageText }],
        })
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
    }
  );
});
