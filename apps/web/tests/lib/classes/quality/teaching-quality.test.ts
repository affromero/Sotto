import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: boundary.resolve,
  capturedLearningAiOptions: async (ai: { model: string; signal: AbortSignal }) => ({
    model: ai.model,
    signal: ai.signal,
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import { generateClassIntro } from '@/lib/classes/class-intro';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Travel',
  objective: 'Describe a short trip',
  grammarPoints: ['past events'],
  targetVocab: [],
};
const intro = {
  purpose: 'Describe a trip',
  about: 'Use past events',
  focus: ['Describe transport'],
  examples: [
    {
      target: 'Ich bin mit dem Bus gefahren.',
      meaning: 'I went by bus.',
      note: 'Use fahren for travel by bus.',
    },
  ],
  tips: ['Name the transport.'],
};
const approved = { items: [{ index: 0, acceptable: true, issues: [] }] };

beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockReset();
  boundary.resolve.mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
  });
  boundary.generate
    .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
    .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });
});

describe('intro teaching gate', () => {
  it('reviews the exact normalized visible intro and visuals with captured options', async () => {
    const result = await generateClassIntro(params);
    const call = boundary.generate.mock.calls[1];
    expect(JSON.parse(call[1][0].content).items).toEqual([{ index: 0, content: result }]);
    expect(call[2]).toMatchObject({ model: 'captured-model', signal: expect.any(AbortSignal) });
    expect(result.examples[0].target).toBe(intro.examples[0].target);
  });

  it('keeps provider-authored teaching when optional visuals are invalid', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...intro,
          visuals: {
            callouts: [{ label: 'Past tense', text: 'Use sein with movement.', tone: 'green' }],
          },
        }),
        model: 'captured-model',
      })
      .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });

    const result = await generateClassIntro(params);

    expect(result.purpose).toBe(intro.purpose);
    expect(result.examples).toEqual(intro.examples);
    expect(result.visuals?.callouts).toEqual(
      intro.tips.map((tip, index) => ({
        label: `Tip ${index + 1}`,
        text: tip,
        tone: ['blue', 'teal', 'rose', 'amber'][index],
      }))
    );
    expect(JSON.parse(boundary.generate.mock.calls[1][1][0].content).items[0].content).toEqual(
      result
    );
  });

  it('reviews the deterministic fallback after malformed JSON', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });
    const result = await generateClassIntro(params);
    expect(JSON.parse(boundary.generate.mock.calls[1][1][0].content).items).toEqual([
      { index: 0, content: result },
    ]);
  });

  it('rejects a deterministic fallback that fails its teaching review', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValue({
        content: JSON.stringify({
          items: [{ index: 0, acceptable: false, issues: ['unsupported'] }],
        }),
        model: 'captured-model',
      });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
  });

  it('propagates authority capture failure without dispatch or fallback', async () => {
    boundary.resolve.mockRejectedValue(new Error('Authority revoked'));
    await expect(generateClassIntro(params)).rejects.toThrow('Authority revoked');
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it.each([
    'not-json',
    JSON.stringify({ items: [] }),
    JSON.stringify({ items: [{ index: 0, acceptable: false, issues: ['incorrect'] }] }),
    JSON.stringify({ items: [{ index: 0, acceptable: true, issues: ['uncertain'] }] }),
    JSON.stringify({ items: [{ index: 1, acceptable: true, issues: [] }] }),
  ])('fails closed on verdict %s', async (content) => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content, model: 'captured-model' });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls).toHaveLength(2);
  });

  it.each(['provider unavailable', 'authorization denied', 'cancelled', 'budget exhausted'])(
    'propagates %s from generation without fallback',
    async (message) => {
      boundary.generate.mockReset().mockRejectedValue(new Error(message));
      await expect(generateClassIntro(params)).rejects.toThrow(message);
      expect(boundary.generate.mock.calls).toHaveLength(1);
    }
  );

  it('propagates reviewer failure without returning the generated or fallback intro', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockRejectedValue(new Error('review unavailable'));
    await expect(generateClassIntro(params)).rejects.toThrow('review unavailable');
  });
});
