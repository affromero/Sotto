import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractReadingVocabulary } from '@/lib/learning/reading-vocabulary';
import {
  compileVocabularyMetadataRepair,
  ReadingVocabularyProtocolError,
} from '@/lib/learning/reading/vocabulary-protocol';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'anthropic', model: 'captured' }),
  capturedLearningAiOptions: async () => ({ model: 'captured' }),
}));
vi.mock('@/lib/providers/ai', () => ({ createAIProvider: () => ({ generateResponse: generate }) }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

const original = [
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
    questionIndices: [0],
  },
];
const repairs = [
  { wordIndex: 1, lemma: 'sehen', gloss: 'see', pos: 'verb' },
  { wordIndex: 0, lemma: 'Mechaniker', gloss: 'mechanic', pos: 'noun' },
];

describe('immutable vocabulary anchors during metadata repair', () => {
  it('applies reordered indexed metadata without changing quotes, order, associations or input', () => {
    const before = structuredClone(original);
    expect(compileVocabularyMetadataRepair(JSON.stringify({ words: repairs }), original)).toEqual([
      { ...original[0], lemma: 'Mechaniker' },
      { ...original[1], lemma: 'sehen', gloss: 'see', pos: 'verb' },
    ]);
    expect(original).toEqual(before);
  });

  it.each([
    { words: [] },
    { words: [repairs[0]] },
    { words: [...repairs, { ...repairs[0], wordIndex: 2 }] },
    { words: [repairs[0], repairs[0]] },
    { words: [repairs[0], { ...repairs[1], wordIndex: -1 }] },
    { words: [repairs[0], { ...repairs[1], wordIndex: 2 }] },
    { words: [repairs[0], { ...repairs[1], wordIndex: 0.5 }] },
    { words: [repairs[0], { ...repairs[1], lemma: 'sehen' }] },
    { words: [repairs[0], { ...repairs[1], gloss: '  ' }] },
    { words: [repairs[0], { ...repairs[1], sourceForm: 'Mechaniker' }] },
    { words: [repairs[0], { ...repairs[1], sourceSpan: { startWordIndex: 1, endWordIndex: 1 } }] },
    { words: [repairs[0], { ...repairs[1], questionIndices: [] }] },
    { words: repairs, extra: 'untrusted' },
  ])('rejects incomplete, ambiguous or anchor-authoring repairs: %j', (repair) => {
    expect(() => compileVocabularyMetadataRepair(JSON.stringify(repair), original)).toThrow(
      ReadingVocabularyProtocolError
    );
  });

  it('reports malformed JSON using a static error without retaining provider output', () => {
    const output = 'private provider response';
    let error: unknown;
    try {
      compileVocabularyMetadataRepair(output, original);
    } catch (failure) {
      error = failure;
    }
    expect(error).toMatchObject({ code: 'malformed_json' });
    expect(JSON.stringify(error)).not.toContain(output);
  });
});

describe('assessment review after metadata repair', () => {
  beforeEach(() => {
    generate.mockReset();
  });

  it.each(['WORD_MEANING_REQUIRED', 'ANSWERABLE_WITHOUT_WORD', 'UNCERTAIN'])(
    'retains repaired words and lets independent evidence decide %s association',
    async (decision) => {
      const question = {
        id: 'reading-1',
        passageText: 'Mia hat das Auto gesehen.',
        question: 'Was hat Mia mit dem Auto gemacht?',
        options: [
          'Sie hat es gesehen.',
          'Sie hat es verkauft.',
          'Sie hat es gefahren.',
          'Sie hat es repariert.',
        ],
        correctIndex: 0,
      };
      generate.mockImplementation(async (_system, messages, settings) => {
        const payload = JSON.parse(messages[0].content);
        let output: unknown;
        if (settings.jsonSchema.name === 'reading_vocabulary_extraction') {
          output = {
            words: [
              {
                lemma: 'gesehen',
                gloss: 'seen',
                pos: 'participle',
                sourceSpan: { startWordIndex: 4, endWordIndex: 4 },
                questionIndices: [0],
              },
            ],
          };
        } else if (settings.jsonSchema.name === 'vocabulary_metadata_repair') {
          expect(settings.jsonSchema.schema.properties.words).toMatchObject({
            minItems: 1,
            maxItems: 1,
            items: {
              additionalProperties: false,
              required: ['wordIndex', 'lemma', 'gloss', 'pos'],
            },
          });
          output = { words: [{ wordIndex: 0, lemma: 'sehen', gloss: 'see', pos: 'verb' }] };
        } else if (settings.jsonSchema.name === 'reading_vocabulary_quality') {
          const content = payload.items[0].content;
          const acceptable = content.lemma === 'sehen';
          expect(content).toMatchObject({
            sourceQuote: 'gesehen',
            questionIndices: [0],
            assessedQuestions: [question],
          });
          output = {
            items: [
              {
                index: 0,
                metadata: {
                  acceptable,
                  issues: acceptable ? [] : ['incorrect'],
                  feedback: acceptable ? [] : ['Use the canonical verb lemma.'],
                },
                associations: [
                  {
                    questionIndex: 0,
                    canAnswerWithoutWord: false,
                    reasoning: 'Understanding the verb distinguishes the actions.',
                  },
                ],
              },
            ],
          };
        } else if (settings.jsonSchema.name === 'reading_vocabulary_counterfactual') {
          output = {
            decisions: [
              {
                questionIndex: 0,
                decision,
                answerIndex: decision === 'ANSWERABLE_WITHOUT_WORD' ? 0 : null,
                reasoning: 'Independent masked-passage review.',
              },
            ],
          };
        } else {
          throw new Error('Unexpected provider request');
        }
        return { content: JSON.stringify(output), model: 'captured' };
      });
      const result = await extractReadingVocabulary({
        userId: 'learner',
        execution: blockedProviderExecution('learner'),
        nativeLang: 'en',
        targetLang: 'de',
        level: 'B1',
        questions: [question],
      });
      expect(result.words).toEqual([
        {
          lemma: 'sehen',
          gloss: 'see',
          pos: 'verb',
          sourceForm: 'gesehen',
          questionIds: decision === 'WORD_MEANING_REQUIRED' ? [question.id] : [],
        },
      ]);
    }
  );
});
