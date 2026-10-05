import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';
import {
  extractReadingVocabulary,
  reviewReadingVocabulary,
} from '@/lib/learning/reading-vocabulary';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { teachingFailureSchema } from '@/lib/classes/quality/teaching-failure';
import type { LearningDatabase } from '@/lib/learning/database';
import { ReadingVocabularyProtocolError } from '@/lib/learning/reading/vocabulary-protocol';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';

const generate = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn() } }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'anthropic', model: 'fixture' }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/providers/ai', () => ({ createAIProvider: () => ({ generateResponse: generate }) }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

const question = {
  id: 'reading-1',
  question: 'What does Ana order?',
  options: ['Coffee', 'Tea', 'Milk', 'Water'],
  correctIndex: 0,
  passageText: 'Ana bestellt einen Kaffee.',
};
const options = {
  userId: 'learner',
  execution: blockedProviderExecution('learner'),
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2',
  questions: [question],
};
const word = {
  lemma: 'bestellen',
  gloss: 'to order',
  pos: 'verb',
  sourceForm: 'bestellt',
  questionIndices: [0],
};
const response = (content: unknown) => ({
  content: JSON.stringify(Array.isArray(content) ? { words: content } : content),
  model: 'fixture',
});
const approved = (count = 1) => ({
  items: Array.from({ length: count }, (_, index) => ({
    index,
    acceptable: true,
    issues: [],
    feedback: [],
  })),
});
const rejected = {
  items: [
    {
      index: 0,
      acceptable: false,
      issues: ['unsupported'],
      feedback: ['This question does not assess the verb.'],
    },
  ],
};
beforeEach(() => {
  generate.mockReset();
  logError.mockReset();
  generate.mockResolvedValueOnce(response([word]));
  generate.mockResolvedValue({
    content: JSON.stringify({ items: [{ index: 0, acceptable: true, issues: [], feedback: [] }] }),
    model: 'fixture',
  });
});

describe('reading vocabulary extraction', () => {
  it('preserves inflected source forms and exact assessed question IDs without audio', async () => {
    const result = await extractReadingVocabulary(options);
    expect(result).toMatchObject({
      passageText: question.passageText,
      words: [
        {
          lemma: 'bestellen',
          sourceForm: 'bestellt',
          gloss: 'to order',
          questionIds: ['reading-1'],
        },
      ],
    });
    expect(result.sourceHash).toHaveLength(64);
    expect(JSON.parse(generate.mock.calls[0]![1][0].content).questions).toEqual([
      { question: question.question, options: question.options, correctIndex: 0 },
    ]);
    expect(
      JSON.parse(generate.mock.calls[1]![1][0].content).items[0].content.assessedQuestions
    ).toEqual([question]);
  });
  it.each([-1, 4, 0.5, undefined])(
    'rejects an invalid private key %s before dispatch',
    async (correctIndex) => {
      await expect(
        extractReadingVocabulary({
          ...options,
          questions: [{ ...question, correctIndex: correctIndex as number }],
        })
      ).rejects.toThrow('private question keys');
      expect(generate).not.toHaveBeenCalled();
    }
  );
  it('rejects a missing or conflicting passage before dispatch', async () => {
    for (const passageText of [null, 'A different passage.']) {
      await expect(
        extractReadingVocabulary({
          ...options,
          questions: [question, { ...question, id: 'reading-2', passageText }],
        })
      ).rejects.toThrow('one exact passage');
    }
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([
    { ...word, sourceForm: 'trinkt' },
    { ...word, sourceForm: 'Bestellt' },
    { ...word, sourceForm: 'bestellt Kaffee' },
    { ...word, questionIndices: [1] },
    { ...word, questionIndices: [0, 0] },
  ])('rejects attribution outside the exact passage or question set: %j', async (invalid) => {
    generate.mockReset();
    generate.mockResolvedValue(response([invalid]));
    await expect(extractReadingVocabulary(options)).rejects.toThrow('attribution');
  });
  it('keeps background vocabulary separate from assessed words', async () => {
    generate.mockReset();
    generate.mockResolvedValueOnce(response([{ ...word, questionIndices: [] }]));
    generate.mockResolvedValueOnce({
      content: JSON.stringify({
        items: [{ index: 0, acceptable: true, issues: [], feedback: [] }],
      }),
      model: 'fixture',
    });
    expect((await extractReadingVocabulary(options)).words[0]?.questionIds).toEqual([]);
  });
  it('corrects metadata once while preserving the original keyed reading material', async () => {
    const replacement = {
      ...word,
      lemma: 'bestellen',
      gloss: 'to place an order',
      questionIndices: [],
    };
    const originalQuestions = structuredClone(options.questions);
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response([{ ...word, lemma: 'trinken', gloss: 'to drink' }]))
      .mockResolvedValueOnce(response(rejected))
      .mockResolvedValueOnce(response([replacement]))
      .mockResolvedValueOnce(response(approved()));
    const result = await extractReadingVocabulary(options);
    expect(result.words).toEqual([
      {
        lemma: 'bestellen',
        gloss: 'to place an order',
        pos: 'verb',
        sourceForm: 'bestellt',
        questionIds: [],
      },
    ]);
    const initial = JSON.parse(generate.mock.calls[0]![1][0].content);
    const correction = JSON.parse(generate.mock.calls[2]![1][0].content);
    expect(correction).toMatchObject({
      passageText: initial.passageText,
      questions: initial.questions,
      correction: {
        words: [{ lemma: 'trinken', sourceForm: 'bestellt' }],
        feedback: [{ index: 0, feedback: rejected.items[0]!.feedback }],
      },
    });
    expect(generate.mock.calls[2]![0]).toContain('preserving each exact sourceForm');
    for (const request of [generate.mock.calls[0]!, generate.mock.calls[2]!]) {
      expect(request[0]).toContain('JSON object containing only a words array');
      expect(request[2].jsonSchema.schema).toMatchObject({
        type: 'object',
        required: ['words'],
        additionalProperties: false,
        properties: {
          words: {
            items: {
              properties: {
                questionIndices: { maxItems: 1, items: { maximum: 0 } },
              },
            },
          },
        },
      });
    }
    expect(generate.mock.calls[3]![0]).toContain('faithful contextual synonyms');
    expect(options.questions).toEqual(originalQuestions);
  });
  it('retains native glosses while correcting incidental vocabulary to unassessed background', async () => {
    const readingQuestion = {
      id: 'reading-purchase',
      question: 'Was kauft Mara?',
      options: ['Äpfel', 'Eine Fahrkarte', 'Ein Buch', 'Eine Suppe'],
      correctIndex: 0,
      passageText: 'Mara kauft am Markt Äpfel.',
    };
    const market = {
      lemma: 'Markt',
      gloss: 'market',
      pos: 'noun',
      sourceForm: 'Markt',
      questionIndices: [0],
    };
    const apple = {
      lemma: 'Apfel',
      gloss: 'apple',
      pos: 'noun',
      sourceForm: 'Äpfel',
      questionIndices: [0],
    };
    const attributionVerdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['unsupported'],
          feedback: ['The purchase question assesses the object, not the market location.'],
        },
        { index: 1, acceptable: true, issues: [], feedback: [] },
      ],
    };
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response([market, apple]))
      .mockResolvedValueOnce(response(attributionVerdict))
      .mockResolvedValueOnce(response([{ ...market, questionIndices: [] }, apple]))
      .mockResolvedValueOnce(response(approved(2)));

    const result = await extractReadingVocabulary({ ...options, questions: [readingQuestion] });

    expect(result.passageText).toBe(readingQuestion.passageText);
    expect(result.words).toEqual([
      { lemma: 'Markt', gloss: 'market', pos: 'noun', sourceForm: 'Markt', questionIds: [] },
      {
        lemma: 'Apfel',
        gloss: 'apple',
        pos: 'noun',
        sourceForm: 'Äpfel',
        questionIds: ['reading-purchase'],
      },
    ]);
    for (const request of [generate.mock.calls[1]!, generate.mock.calls[3]!]) {
      expect(request[0]).toContain('gloss is a dictionary meaning in the native language (en)');
      expect(request[0]).toContain('never to vocabulary metadata');
      expect(request[0]).toContain(
        'Reject incorrect glosses, invented forms and unsupported assessment attribution'
      );
    }
    const correctedReview = JSON.parse(generate.mock.calls[3]![1][0].content);
    expect(correctedReview.items[0].content.assessedQuestions).toEqual([]);
    expect(correctedReview.items[1].content.assessedQuestions).toEqual([readingQuestion]);
  });
  it('maps late-batch feedback to whole-candidate indices and reviews all replacement batches', async () => {
    const words = Array.from({ length: 12 }, (_, index) => ({
      ...word,
      lemma: `word-${index}`,
      sourceForm: `token${index}`,
      questionIndices: [],
    }));
    const passageText = words.map((item) => item.sourceForm).join(' ');
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response(words))
      .mockResolvedValueOnce(response(approved(5)))
      .mockResolvedValueOnce(response(approved(5)))
      .mockResolvedValueOnce(
        response({
          items: [rejected.items[0], { index: 1, acceptable: true, issues: [], feedback: [] }],
        })
      )
      .mockResolvedValueOnce(response(words))
      .mockResolvedValueOnce(response(approved(5)))
      .mockResolvedValueOnce(response(approved(5)))
      .mockResolvedValueOnce(response(approved(2)));
    const result = await extractReadingVocabulary({
      ...options,
      questions: [{ ...question, passageText }],
    });
    expect(result.words).toHaveLength(12);
    expect(JSON.parse(generate.mock.calls[4]![1][0].content).correction.feedback).toEqual([
      { index: 10, feedback: rejected.items[0]!.feedback },
    ]);
    expect(
      generate.mock.calls
        .slice(5)
        .map((call) =>
          JSON.parse(call[1][0].content).items.map(
            (item: { content: { sourceForm: string } }) => item.content.sourceForm
          )
        )
    ).toEqual(
      [words.slice(0, 5), words.slice(5, 10), words.slice(10)].map((batch) =>
        batch.map((item) => item.sourceForm)
      )
    );
  });
  it('retains both original schema-valid batch candidates and verdicts on a second rejection', async () => {
    generate.mockReset();
    const replacement = { ...word, gloss: 'to drink' };
    generate
      .mockResolvedValueOnce(response([word]))
      .mockResolvedValueOnce(response(rejected))
      .mockResolvedValueOnce(response([replacement]))
      .mockResolvedValueOnce(response(rejected));
    const error = await extractReadingVocabulary(options).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const failure = teachingFailureSchema.parse(
      (error as TeachingQualityRejectionError).teachingFailure
    );
    expect(failure.reviews.map((review) => review.verdict)).toEqual([rejected, rejected]);
    expect(failure.reviews.map((review) => JSON.parse(review.candidate!)[0].gloss)).toEqual([
      'to order',
      'to drink',
    ]);
    expect(generate).toHaveBeenCalledTimes(4);
  });
  it.each([
    { replacement: [], error: 'invalid vocabulary' },
    {
      replacement: [{ ...word }, { ...word, lemma: 'Kaffee', sourceForm: 'Kaffee' }],
      error: 'source identities',
    },
    { replacement: [{ ...word, sourceForm: 'Kaffee' }], error: 'source identities' },
  ])(
    'rejects replacement word loss, addition or source-form changes: %j',
    async ({ replacement, error }) => {
      generate.mockReset();
      generate
        .mockResolvedValueOnce(response([word]))
        .mockResolvedValueOnce(response(rejected))
        .mockResolvedValueOnce(response(replacement));
      await expect(extractReadingVocabulary(options)).rejects.toThrow(error);
      expect(generate).toHaveBeenCalledTimes(3);
    }
  );
  it.each(['reordered', 'dropped'])(
    'rejects %s source identities even when every form occurs in the passage',
    async (change) => {
      const words = [word, { ...word, lemma: 'Kaffee', sourceForm: 'Kaffee' }];
      generate.mockReset();
      generate
        .mockResolvedValueOnce(response(words))
        .mockResolvedValueOnce(
          response({
            items: [rejected.items[0], { index: 1, acceptable: true, issues: [], feedback: [] }],
          })
        )
        .mockResolvedValueOnce(response(change === 'reordered' ? [...words].reverse() : [word]));
      await expect(extractReadingVocabulary(options)).rejects.toThrow('source identities');
    }
  );
  it('does not correct malformed review protocols', async () => {
    generate.mockReset();
    generate.mockResolvedValueOnce(response([word])).mockResolvedValueOnce(response({ items: [] }));
    await expect(extractReadingVocabulary(options)).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(logError).not.toHaveBeenCalled();
  });
  it.each(['review', 'replacement', 'replacement review'])(
    'propagates the actual %s provider failure without retry',
    async (stage) => {
      const failure = new Error(`Provider failed during ${stage}`);
      generate.mockReset();
      generate.mockResolvedValueOnce(response([word]));
      if (stage !== 'review') generate.mockResolvedValueOnce(response(rejected));
      if (stage === 'replacement review') generate.mockResolvedValueOnce(response([word]));
      generate.mockRejectedValueOnce(failure);
      await expect(extractReadingVocabulary(options)).rejects.toBe(failure);
      expect(logError).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledTimes(
        stage === 'review' ? 2 : stage === 'replacement' ? 3 : 4
      );
    }
  );
  it('propagates malformed replacement JSON instead of retaining an earlier semantic rejection', async () => {
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response([word]))
      .mockResolvedValueOnce(response(rejected))
      .mockResolvedValueOnce({ content: 'not JSON', model: 'fixture' });
    await expect(extractReadingVocabulary(options)).rejects.toThrow('malformed JSON');
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it('propagates cancellation during correction without another provider request', async () => {
    const cancellation = new DOMException('Cancelled by learner', 'AbortError');
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response([word]))
      .mockResolvedValueOnce(response(rejected))
      .mockRejectedValueOnce(cancellation);
    await expect(extractReadingVocabulary(options)).rejects.toBe(cancellation);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(logError).not.toHaveBeenCalled();
  });
  it('does not advance SRS for a reviewed background word', async () => {
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response([word]))
      .mockResolvedValueOnce(response(rejected))
      .mockResolvedValueOnce(response([{ ...word, questionIndices: [] }]))
      .mockResolvedValueOnce(response(approved()));
    const snapshot = await extractReadingVocabulary(options);
    const database = new Proxy({} as LearningDatabase, {
      get() {
        throw new Error('Background words must not read or write SRS.');
      },
    });
    expect(
      await reviewReadingVocabulary(
        database,
        'course',
        snapshot,
        new Map([['reading-1', true]]),
        new Date()
      )
    ).toEqual(new Set());
  });
  it('advances only the reviewed assessed word while preserving background SRS state', async () => {
    const background = {
      ...word,
      lemma: 'Kaffee',
      sourceForm: 'Kaffee',
      pos: 'noun',
      gloss: 'coffee',
      questionIndices: [],
    };
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response([word, background]))
      .mockResolvedValueOnce(response(approved(2)));
    const snapshot = await extractReadingVocabulary(options);
    const states = snapshot.words.map((item, index) => ({
      id: `word-${index}`,
      lemma: item.lemma,
      ease: 2.5,
      intervalDays: 0,
      reps: 0,
      lapses: 0,
      mastery: 0,
    }));
    const database = {
      learnerVocab: {
        findMany: async ({ where }: { where: { lemma: { in: string[] } } }) =>
          states.filter((state) => where.lemma.in.includes(state.lemma)),
        update: async ({ where, data }: { where: { id: string }; data: object }) =>
          Object.assign(
            states.find((state) => state.id === where.id)!,
            data
          ),
      },
      learnerGrammar: { findMany: async () => [] },
    } as unknown as LearningDatabase;
    expect(
      await reviewReadingVocabulary(
        database,
        'course',
        snapshot,
        new Map([['reading-1', true]]),
        new Date('2026-10-05T00:00:00Z')
      )
    ).toEqual(new Set(['bestellen']));
    expect(states[0]).toMatchObject({ lemma: 'bestellen', reps: 1 });
    expect(states[1]).toEqual({
      id: 'word-1',
      lemma: 'Kaffee',
      ease: 2.5,
      intervalDays: 0,
      reps: 0,
      lapses: 0,
      mastery: 0,
    });
  });
  it('surfaces provider failures without publishing an empty extraction', async () => {
    generate.mockReset();
    generate.mockRejectedValue(new Error('Provider unavailable'));
    await expect(extractReadingVocabulary(options)).rejects.toThrow('Provider unavailable');
    expect(logError).not.toHaveBeenCalled();
  });
  it.each([
    { content: 'private malformed provider body', code: 'malformed_json' },
    { content: JSON.stringify([word]), code: 'invalid_shape' },
    {
      content: JSON.stringify({ words: [{ ...word, extra: 'private extra field' }] }),
      code: 'invalid_shape',
    },
    { content: JSON.stringify({ words: [] }), code: 'invalid_shape' },
    {
      content: JSON.stringify({ words: [{ ...word, sourceForm: 'private absent form' }] }),
      code: 'source_attribution',
      attributionViolations: [{ code: 'source_form_missing', wordIndex: 0 }],
    },
    {
      content: JSON.stringify({ words: [{ ...word, questionIndices: [1] }] }),
      code: 'source_attribution',
      attributionViolations: [{ code: 'out_of_range', wordIndex: 0 }],
    },
    {
      content: JSON.stringify({ words: [{ ...word, questionIndices: [0, 0] }] }),
      code: 'source_attribution',
      attributionViolations: [{ code: 'dup_question_index', wordIndex: 0 }],
    },
    {
      content: JSON.stringify({ words: [word, word] }),
      code: 'source_attribution',
      attributionViolations: [{ code: 'dup_lemma', wordIndex: 1 }],
    },
  ])(
    'rejects invalid structured output with a safe correlated protocol code: $code',
    async ({ content, code, attributionViolations }) => {
      generate.mockReset();
      generate.mockImplementation(async (system, messages, requestOptions) => {
        expect(system).toContain('Return a JSON object containing only a words array');
        expect(JSON.parse(messages[0].content).passageText).toBe(question.passageText);
        expect(requestOptions.jsonSchema.schema.properties.words).toMatchObject({
          type: 'array',
          minItems: 1,
          maxItems: 12,
        });
        return { content, model: 'fixture' };
      });
      const failure = await extractReadingVocabulary(options).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ReadingVocabularyProtocolError);
      expect(failure).toMatchObject({ code });
      expect(captureGenerationFailure(failure)).toEqual({ category: 'generation_failed' });
      expect(logError.mock.calls).toEqual([
        [
          'Reading vocabulary output protocol rejected',
          {
            code,
            sourceHash: createHash('sha256').update(question.passageText).digest('hex'),
            questionCount: 1,
            questionIds: [question.id],
            questionIdsSha256: createHash('sha256')
              .update(JSON.stringify([question.id]))
              .digest('hex'),
            ...(attributionViolations ? { attributionViolations } : {}),
          },
        ],
      ]);
      expect(JSON.stringify(failure)).not.toContain(content);
      expect(JSON.stringify(logError.mock.calls)).not.toContain('private');
      expect(failure).not.toHaveProperty('cause');
      expect(generate.mock.calls.map((request) => JSON.parse(request[1][0].content))).toEqual([
        {
          passageText: question.passageText,
          questions: [{ question: question.question, options: question.options, correctIndex: 0 }],
        },
      ]);
    }
  );
  it('omits oversized question identities from protocol logs without restricting generation inputs', async () => {
    const id = 'reading-'.repeat(600);
    generate.mockReset();
    generate.mockResolvedValue({ content: 'private malformed output', model: 'fixture' });
    const failure = await extractReadingVocabulary({
      ...options,
      questions: [{ ...question, id }],
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'malformed_json' });
    const diagnostic = logError.mock.calls[0]![1];
    expect(diagnostic).toMatchObject({
      questionCount: 1,
      questionIdsOmitted: 'size_limit',
      questionIdsSha256: createHash('sha256')
        .update(JSON.stringify([id]))
        .digest('hex'),
    });
    expect(diagnostic).not.toHaveProperty('questionIds');
    expect(JSON.stringify(diagnostic)).not.toContain(id);
  });
  it('reports replacement source-identity rejection without retaining the rejected provider body', async () => {
    generate.mockReset();
    generate
      .mockResolvedValueOnce(response([word]))
      .mockResolvedValueOnce(response(rejected))
      .mockResolvedValueOnce(response([{ ...word, sourceForm: 'Kaffee' }]));
    const failure = await extractReadingVocabulary(options).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'replacement_identity' });
    expect(captureGenerationFailure(failure)).toEqual({ category: 'generation_failed' });
    expect(logError.mock.calls[0]![1]).toMatchObject({
      code: 'replacement_identity',
      questionIds: [question.id],
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('Kaffee');
  });
});
