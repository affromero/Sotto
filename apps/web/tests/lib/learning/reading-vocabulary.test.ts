import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';
import { extractReadingVocabulary } from '@/lib/learning/reading-vocabulary';

const generate = vi.hoisted(() => vi.fn());
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
beforeEach(() => {
  generate.mockReset();
  generate.mockResolvedValueOnce({ content: JSON.stringify([word]), model: 'fixture' });
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
  });
  it.each([
    { ...word, sourceForm: 'trinkt' },
    { ...word, questionIndices: [1] },
    { ...word, questionIndices: [0, 0] },
  ])('rejects attribution outside the exact passage or question set: %j', async (invalid) => {
    generate.mockReset();
    generate.mockResolvedValue({ content: JSON.stringify([invalid]), model: 'fixture' });
    await expect(extractReadingVocabulary(options)).rejects.toThrow('attribution');
  });
  it('keeps background vocabulary separate from assessed words', async () => {
    generate.mockReset();
    generate.mockResolvedValueOnce({
      content: JSON.stringify([{ ...word, questionIndices: [] }]),
      model: 'fixture',
    });
    generate.mockResolvedValueOnce({
      content: JSON.stringify({
        items: [{ index: 0, acceptable: true, issues: [], feedback: [] }],
      }),
      model: 'fixture',
    });
    expect((await extractReadingVocabulary(options)).words[0]?.questionIds).toEqual([]);
  });
  it('rejects a false gloss or unsupported assessment when semantic review rejects it', async () => {
    generate.mockReset();
    generate.mockResolvedValueOnce({ content: JSON.stringify([word]), model: 'fixture' });
    generate.mockResolvedValueOnce({
      content: JSON.stringify({
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['unsupported'],
            feedback: ['This question does not assess the verb.'],
          },
        ],
      }),
      model: 'fixture',
    });
    await expect(extractReadingVocabulary(options)).rejects.toThrow();
  });
  it('surfaces provider failures without publishing an empty extraction', async () => {
    generate.mockReset();
    generate.mockRejectedValue(new Error('Provider unavailable'));
    await expect(extractReadingVocabulary(options)).rejects.toThrow('Provider unavailable');
  });
});
