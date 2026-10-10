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
  boundary.generate.mockImplementation(async (_system, messages, settings) => {
    if (settings.jsonSchema.name === 'reading_vocabulary_counterfactual') {
      const payload = JSON.parse(messages[0].content).items[0].content;
      return {
        content: JSON.stringify({
          decisions: payload.questions.map(({ questionIndex }: { questionIndex: number }) => ({
            questionIndex,
            decision: 'WORD_MEANING_REQUIRED',
            answerIndex: null,
            reasoning: 'The visible passage does not identify the semantic answer.',
          })),
        }),
        model: 'captured',
      };
    }
    return { content: JSON.stringify(verdict), model: 'captured' };
  });
});

describe('independent reading vocabulary admission', () => {
  it.each([
    {
      lemma: 'Foto',
      gloss: 'photo; here, an old photo',
      pos: 'noun',
      sourceForm: 'alte Fotos',
      passageText: 'Im Museum haben wir alte Fotos gesehen.',
    },
    {
      lemma: 'anrufen',
      gloss: 'to call by telephone',
      pos: 'verb',
      sourceForm: 'rufe meine Tante an',
      passageText: 'Ich rufe meine Tante an.',
    },
  ])(
    'reviews the complete quotation for $lemma without changing stored word identity',
    async (word) => {
      const request = {
        ...options(),
        items: [{ ...word, questionIndices: [], assessedQuestions: [] }],
      };
      const original = structuredClone(request.items);
      boundary.generate.mockResolvedValue({
        content: JSON.stringify({ items: [{ index: 0, metadata, associations: [] }] }),
      });
      expect(await reviewReadingVocabularyContent(request)).toEqual([[]]);
      expect(request.items).toEqual(original);
      const { sourceForm, ...fields } = original[0]!;
      expect(JSON.parse(boundary.generate.mock.calls[0]![1][0].content)).toEqual({
        items: [{ index: 0, content: { ...fields, sourceQuote: sourceForm } }],
      });
    }
  );

  it('retains rejected lexical metadata and its original source quotation in private evidence', async () => {
    const word = {
      lemma: 'Foto',
      gloss: 'apple',
      pos: 'noun',
      sourceForm: 'alte Fotos',
      passageText: 'Im Museum haben wir alte Fotos gesehen.',
      questionIndices: [],
      assessedQuestions: [],
    };
    const rejected = {
      acceptable: false,
      issues: ['incorrect'],
      feedback: ['Foto means photo, not apple.'],
    };
    boundary.generate.mockResolvedValue({
      content: JSON.stringify({ items: [{ index: 0, metadata: rejected, associations: [] }] }),
    });
    const failure = await reviewReadingVocabularyContent({ ...options(), items: [word] }).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(failure.issues).toEqual(['incorrect']);
    const evidence = teachingFailureSchema.parse(failure.teachingFailure);
    expect(JSON.parse(evidence.reviews[0]!.candidate!)[0]).toMatchObject({
      ...word,
      actualReview: { index: 0, metadata: rejected, associations: [] },
    });
    expect(JSON.parse(evidence.reviews[0]!.candidate!)[0]).not.toHaveProperty('sourceQuote');
  });

  it('retains only explicitly supported links, preserving proposed input and captured request settings', async () => {
    const request = options();
    const original = structuredClone(request.items);
    expect(await reviewReadingVocabularyContent(request)).toEqual([[1]]);
    expect(request.items).toEqual(original);
    const [system, messages, settings] = boundary.generate.mock.calls[0]!;
    const { sourceForm, ...reviewedItem } = item;
    expect(JSON.parse(messages[0].content)).toEqual({
      items: [{ index: 0, content: { ...reviewedItem, sourceQuote: sourceForm } }],
    });
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
    expect(boundary.generate).toHaveBeenCalledTimes(1);
  });

  it('withholds copied location credit despite an approving original review', async () => {
    const request = options();
    request.items = [
      {
        ...item,
        lemma: 'der Bahnhof',
        sourceForm: 'Bahnhof',
        gloss: 'train station',
        passageText: 'Paula hat ihre Gäste am Bahnhof abgeholt.',
        questionIndices: [0],
        assessedQuestions: [
          {
            ...question,
            question: 'Wo hat Paula ihre Gäste getroffen?',
            options: ['Im Park.', 'In ihrer Küche.', 'Am Bahnhof.', 'Vor dem Haus der Musiker.'],
            correctIndex: 2,
          },
        ],
      },
    ];
    boundary.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            {
              index: 0,
              metadata,
              associations: [
                {
                  questionIndex: 0,
                  canAnswerWithoutWord: false,
                  reasoning: 'A location is assessed.',
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          decisions: [
            {
              questionIndex: 0,
              decision: 'ANSWERABLE_WITHOUT_WORD',
              answerIndex: 2,
              reasoning: 'The pickup event identifies the repeated opaque location.',
            },
          ],
        }),
      });
    const original = structuredClone(request.items);
    expect(await reviewReadingVocabularyContent(request)).toEqual([[]]);
    expect(request.items).toEqual(original);
    const [system, messages, settings] = boundary.generate.mock.calls[1]!;
    const payload = JSON.parse(messages[0].content);
    expect(payload).toEqual({
      items: [
        {
          index: 0,
          content: {
            passageText: 'Paula hat ihre Gäste am [WORD] abgeholt.',
            questions: [
              {
                questionIndex: 0,
                question: 'Wo hat Paula ihre Gäste getroffen?',
                options: ['Im Park.', 'In ihrer Küche.', 'Am [WORD].', 'Vor dem Haus der Musiker.'],
              },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify({ system, payload })).not.toMatch(/Bahnhof|train station/);
    expect(JSON.stringify(payload)).not.toMatch(/correctIndex|gloss|lemma|explanation/);
    expect(settings).toMatchObject({
      model: 'captured',
      signal: request.ai.execution.signal,
      temperature: 0,
      maxTokens: 2048,
      jsonSchema: { name: 'reading_vocabulary_counterfactual' },
    });
  });

  it('isolates each approved word so neighboring passages cannot reveal its identity', async () => {
    const request = options();
    request.items = [
      {
        ...item,
        passageText: 'Ana kauft Äpfel und Brot.',
        questionIndices: [0],
        assessedQuestions: [question],
      },
      {
        ...item,
        lemma: 'Brot',
        sourceForm: 'Brot',
        gloss: 'bread',
        passageText: 'Ana kauft Äpfel und Brot.',
        questionIndices: [0],
        assessedQuestions: [question],
      },
    ];
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify({
        items: request.items.map((_, index) => ({
          index,
          metadata,
          associations: [
            { questionIndex: 0, canAnswerWithoutWord: false, reasoning: 'Meaning required.' },
          ],
        })),
      }),
    });
    expect(await reviewReadingVocabularyContent(request)).toEqual([[0], [0]]);
    const payloads = boundary.generate.mock.calls
      .slice(1)
      .map((call) => JSON.parse(call[1][0].content));
    expect(payloads.map((payload) => payload.items)).toEqual([
      [
        {
          index: 0,
          content: {
            passageText: 'Ana kauft [WORD] und Brot.',
            questions: [
              { questionIndex: 0, question: question.question, options: question.options },
            ],
          },
        },
      ],
      [
        {
          index: 0,
          content: {
            passageText: 'Ana kauft Äpfel und [WORD].',
            questions: [
              { questionIndex: 0, question: question.question, options: question.options },
            ],
          },
        },
      ],
    ]);
  });

  it('normalizes known forms without masking parts of a different word', async () => {
    const request = options();
    request.items = [
      {
        ...item,
        lemma: 'das Café',
        sourceForm: 'café',
        passageText: 'Ein Cafe\u0301, kein Caféhaus und kein Café_Ort.',
        questionIndices: [0],
        assessedQuestions: [
          { ...question, question: 'Was bedeutet CAFÉ?', options: ['Ein café.', 'A house.'] },
        ],
      },
    ];
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify({
        items: [
          {
            index: 0,
            metadata,
            associations: [
              { questionIndex: 0, canAnswerWithoutWord: false, reasoning: 'Meaning required.' },
            ],
          },
        ],
      }),
    });
    expect(await reviewReadingVocabularyContent(request)).toEqual([[0]]);
    expect(JSON.parse(boundary.generate.mock.calls[1]![1][0].content).items[0].content).toEqual({
      passageText: 'Ein [WORD], kein Caféhaus und kein Café_Ort.',
      questions: [
        {
          questionIndex: 0,
          question: 'Was bedeutet [WORD]?',
          options: ['Ein [WORD].', 'A house.'],
        },
      ],
    });
  });

  it.each(['ANSWERABLE_WITHOUT_WORD', 'UNCERTAIN'])(
    'withholds original credit on masked %s, including an unsupported answer key',
    async (decision) => {
      boundary.generate
        .mockResolvedValueOnce({ content: JSON.stringify(verdict) })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            decisions: [
              {
                questionIndex: 1,
                decision,
                answerIndex: decision === 'ANSWERABLE_WITHOUT_WORD' ? 2 : null,
                reasoning: 'No reliable necessity proof.',
              },
            ],
          }),
        });
      expect(await reviewReadingVocabularyContent(options())).toEqual([[]]);
    }
  );

  it.each([undefined, -1, 0.5, 4])(
    'rejects an invalid assessed answer key %s before any review dispatch',
    async (correctIndex) => {
      const request = options();
      request.items[0]!.assessedQuestions[0]!.correctIndex = correctIndex as number;
      await expect(reviewReadingVocabularyContent(request)).rejects.toBeInstanceOf(
        ReviewerProtocolError
      );
      expect(boundary.generate).not.toHaveBeenCalled();
    }
  );

  it('rejects an existing marker in question options without sending an ambiguous mask', async () => {
    const request = options();
    request.items[0]!.assessedQuestions[0]!.options[0] = '[WORD]';
    await expect(reviewReadingVocabularyContent(request)).rejects.toBeInstanceOf(
      ReviewerProtocolError
    );
    expect(boundary.generate).toHaveBeenCalledTimes(1);
  });

  const twoPairVerdict = {
    items: [
      {
        index: 0,
        metadata,
        associations: [1, 3].map((questionIndex) => ({
          questionIndex,
          canAnswerWithoutWord: false,
          reasoning: 'The original review supports this meaning.',
        })),
      },
    ],
  };
  const requiredPair = (questionIndex: number) => ({
    questionIndex,
    decision: 'WORD_MEANING_REQUIRED',
    answerIndex: null,
    reasoning: 'The opaque word meaning is necessary.',
  });
  it.each([
    { label: 'missing one of two pairs', decisions: [requiredPair(1)] },
    {
      label: 'duplicate within the expected pair count',
      decisions: [requiredPair(1), requiredPair(1)],
    },
    {
      label: 'unknown pair replacing an expected pair',
      decisions: [requiredPair(0), requiredPair(3)],
    },
    {
      label: 'answer valid for another question only',
      decisions: [
        {
          questionIndex: 1,
          decision: 'ANSWERABLE_WITHOUT_WORD',
          answerIndex: 2,
          reasoning: 'An option was selected.',
        },
        requiredPair(3),
      ],
    },
  ])('rejects masked $label with per-question bounds', async ({ decisions }) => {
    const request = options();
    request.items[0]!.assessedQuestions[0]!.options = ['Apples', 'Bread'];
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(twoPairVerdict) })
      .mockResolvedValueOnce({ content: JSON.stringify({ decisions }) });
    await expect(reviewReadingVocabularyContent(request)).rejects.toBeInstanceOf(
      ReviewerProtocolError
    );
    expect(boundary.generate).toHaveBeenCalledTimes(2);
  });

  it('matches reordered masked decisions to exact pairs while retaining input order', async () => {
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(twoPairVerdict) })
      .mockResolvedValueOnce({
        content: JSON.stringify({ decisions: [requiredPair(3), requiredPair(1)] }),
      });
    expect(await reviewReadingVocabularyContent(options())).toEqual([[1, 3]]);
  });

  it.each([
    { label: 'existing passage marker', passageText: 'Ana kauft Äpfel. [WORD]' },
    { label: 'missing known source form', passageText: 'Ana trinkt Tee.' },
    { label: 'only a partial token', passageText: 'Ana besucht Äpfelhaus.' },
  ])(
    'rejects an unreliable mask with $label before a counterfactual dispatch',
    async ({ passageText }) => {
      await expect(
        reviewReadingVocabularyContent({ ...options(), items: [{ ...item, passageText }] })
      ).rejects.toBeInstanceOf(ReviewerProtocolError);
      expect(boundary.generate).toHaveBeenCalledTimes(1);
    }
  );

  const maskedDecision = {
    questionIndex: 1,
    decision: 'WORD_MEANING_REQUIRED',
    answerIndex: null,
    reasoning: 'The hidden word meaning is necessary.',
  };
  it.each([
    { label: 'malformed JSON', content: 'not JSON' },
    { label: 'missing pair', content: JSON.stringify({ decisions: [] }) },
    {
      label: 'extra pair',
      content: JSON.stringify({
        decisions: [maskedDecision, { ...maskedDecision, questionIndex: 3 }],
      }),
    },
    {
      label: 'duplicate pair',
      content: JSON.stringify({ decisions: [maskedDecision, maskedDecision] }),
    },
    {
      label: 'invented pair',
      content: JSON.stringify({ decisions: [{ ...maskedDecision, questionIndex: 0 }] }),
    },
    {
      label: 'answer outside options',
      content: JSON.stringify({
        decisions: [{ ...maskedDecision, decision: 'ANSWERABLE_WITHOUT_WORD', answerIndex: 4 }],
      }),
    },
    {
      label: 'meaning verdict carrying answer',
      content: JSON.stringify({ decisions: [{ ...maskedDecision, answerIndex: 0 }] }),
    },
    {
      label: 'extra answer key',
      content: JSON.stringify({ decisions: [{ ...maskedDecision, correctIndex: 0 }] }),
    },
    {
      label: 'blank reasoning',
      content: JSON.stringify({ decisions: [{ ...maskedDecision, reasoning: ' ' }] }),
    },
  ])('fails closed on masked $label without another request', async ({ content }) => {
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(verdict) })
      .mockResolvedValueOnce({ content });
    await expect(reviewReadingVocabularyContent(options())).rejects.toBeInstanceOf(
      ReviewerProtocolError
    );
    expect(boundary.generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Error('Masked provider transport failed'),
    new DOMException('Cancelled', 'AbortError'),
  ])('propagates a masked provider failure without a repair request', async (error) => {
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(verdict) })
      .mockRejectedValueOnce(error);
    await expect(reviewReadingVocabularyContent(options())).rejects.toBe(error);
    expect(boundary.generate).toHaveBeenCalledTimes(2);
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
