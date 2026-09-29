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

  it('repairs malformed generated teaching before reviewing the exact result', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });
    const result = await generateClassIntro(params);
    expect(boundary.generate.mock.calls[1][2]).toMatchObject({
      model: 'captured-model',
      signal: expect.any(AbortSignal),
      temperature: 0,
      jsonSchema: expect.objectContaining({ name: 'class_intro_repair' }),
    });
    expect(boundary.generate.mock.calls[1][0]).toContain('Level: A2');
    expect(boundary.generate.mock.calls[1][0]).toContain('target language is "de"');
    expect(boundary.generate.mock.calls[1][1][0].content).toContain('"required"');
    expect(boundary.generate.mock.calls[1][1][0].content).toContain('"purpose"');
    expect(JSON.parse(boundary.generate.mock.calls[2][1][0].content).items).toEqual([
      { index: 0, content: result },
    ]);
  });

  it('repairs generated teaching whose examples normalize to empty', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...intro,
          examples: [{ target: 'Reise', meaning: 'Reise', note: 'Reise' }],
        }),
        model: 'captured-model',
      })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });

    const result = await generateClassIntro(params);

    expect(result.examples).toEqual(intro.examples);
    expect(boundary.generate.mock.calls).toHaveLength(3);
  });

  it('replaces a structurally valid intro rejected by teaching review', async () => {
    const replacement = {
      ...intro,
      examples: [{ ...intro.examples[0], note: 'Use sein with movement in the Perfekt.' }],
    };
    const rejected = { items: [{ index: 0, acceptable: false, issues: ['unnatural'] }] };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'captured-model' });

    await expect(generateClassIntro(params)).resolves.toMatchObject(replacement);
    expect(boundary.generate).toHaveBeenCalledTimes(4);
    expect(boundary.generate.mock.calls[2][2].jsonSchema.name).toBe('class_intro_repair');
    expect(boundary.generate.mock.calls[2][1][0].content).toContain(
      'failed an independent teaching-quality review'
    );
    expect(boundary.generate.mock.calls[2][1][0].content).toContain(
      'Correct its teaching meaning, grammar, idiomatic usage, and collocations'
    );
  });

  it('fails closed when the bounded quality replacement is also rejected', async () => {
    const rejected = { items: [{ index: 0, acceptable: false, issues: ['unnatural'] }] };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' });

    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate).toHaveBeenCalledTimes(4);
  });

  it('does not add another replacement after structural repair fails teaching review', async () => {
    const rejected = { items: [{ index: 0, acceptable: false, issues: ['unnatural'] }] };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' });

    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate).toHaveBeenCalledTimes(3);
  });

  it('propagates quality replacement provider failure without another call', async () => {
    const error = new Error('authorization denied');
    const rejected = { items: [{ index: 0, acceptable: false, issues: ['unnatural'] }] };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' })
      .mockRejectedValueOnce(error);

    await expect(generateClassIntro(params)).rejects.toBe(error);
    expect(boundary.generate).toHaveBeenCalledTimes(3);
  });

  it('fails closed when repaired teaching remains unusable', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValue({
        content: JSON.stringify({ ...intro, examples: [] }),
        model: 'captured-model',
      });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls).toHaveLength(2);
  });

  it('propagates authority capture failure without dispatch or fallback', async () => {
    boundary.resolve.mockRejectedValue(new Error('Authority revoked'));
    await expect(generateClassIntro(params)).rejects.toThrow('Authority revoked');
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it.each([
    'not-json',
    JSON.stringify({ items: [] }),
    JSON.stringify({ items: [{ index: 1, acceptable: true, issues: [] }] }),
  ])('fails closed on malformed review protocol %s without replacement', async (content) => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content, model: 'captured-model' });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls).toHaveLength(2);
  });

  it.each([
    JSON.stringify({ items: [{ index: 0, acceptable: false, issues: ['incorrect'] }] }),
    JSON.stringify({ items: [{ index: 0, acceptable: true, issues: ['uncertain'] }] }),
  ])('uses one bounded replacement for semantic rejection %s', async (content) => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content, model: 'captured-model' });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls).toHaveLength(3);
  });

  it.each(['provider unavailable', 'authorization denied', 'cancelled', 'budget exhausted'])(
    'propagates %s from generation without repair',
    async (message) => {
      boundary.generate.mockReset().mockRejectedValue(new Error(message));
      await expect(generateClassIntro(params)).rejects.toThrow(message);
      expect(boundary.generate.mock.calls).toHaveLength(1);
    }
  );

  it('propagates repair provider failure without returning metadata fallback', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockRejectedValueOnce(new Error('repair unavailable'));
    await expect(generateClassIntro(params)).rejects.toThrow('repair unavailable');
    expect(boundary.generate.mock.calls).toHaveLength(2);
  });

  it('propagates reviewer failure without returning the generated or fallback intro', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockRejectedValue(new Error('review unavailable'));
    await expect(generateClassIntro(params)).rejects.toThrow('review unavailable');
  });
});
