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
import { logger } from '@/lib/logger';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';

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
const approved = { items: [{ index: 0, acceptable: true, issues: [], feedback: [] }] };
const rejected = {
  items: [
    {
      index: 0,
      acceptable: false,
      issues: ['unnatural'],
      feedback: ['The example uses the wrong auxiliary for movement.'],
    },
  ],
};

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
  it('keeps rejected A2 meanings and misleading visual claims out of published teaching', async () => {
    const candidate = {
      ...intro,
      examples: [
        {
          target: 'Ich habe gestern einen Film gesehen.',
          meaning: 'Der Film war gestern Gegenstand meines Sehens.',
          note: 'Das Partizip steht im Hauptsatz am Ende.',
        },
        {
          target: 'Wir sind zu Fuß nach Hause gegangen.',
          meaning: 'Wir haben uns gehend nach Hause bewegt.',
          note: 'Hier steht gehen mit sein.',
        },
      ],
      visuals: {
        contrast: {
          title: 'Hilfsverb vergleichen',
          leftLabel: 'Mit haben',
          leftItems: ['Mara hat besucht'],
          rightLabel: 'Mit sein',
          rightItems: ['Wir sind nach Hause gegangen.'],
        },
        callouts: [
          {
            label: 'Merksatz',
            text: 'Das Hilfsverb steht vorn im Satzbau.',
            tone: 'blue',
          },
        ],
      },
    };
    const verdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['unnatural', 'incorrect'],
          feedback: [
            'examples[0].meaning: Gegenstand meines Sehens is an unnatural paraphrase.',
            'examples[1].meaning: gehend nach Hause bewegt is an unnatural paraphrase.',
            'visuals.callouts[0].text: the finite auxiliary occupies the second main-clause position.',
            'visuals.contrast.leftItems: besuchen requires its object here.',
          ],
        },
      ],
    };
    const replacement = {
      ...intro,
      examples: candidate.examples.map((example) => ({ ...example, meaning: example.target })),
    };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(verdict), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'captured-model' });

    const result = await generateClassIntro(params);

    expect(result.examples).toEqual(replacement.examples);
    expect(result.visuals).toBeUndefined();
    expect(boundary.generate.mock.calls[0][0]).toContain('plain, everyday wording');
    expect(boundary.generate.mock.calls[0][0]).toContain("verb's required complements");
    expect(boundary.generate.mock.calls[2][0]).toContain('plain, everyday wording');
    expect(boundary.generate.mock.calls[2][1][0].content).toContain(verdict.items[0].feedback[0]);
    expect(boundary.generate.mock.calls[1][0]).toContain('shortened visual claims');
    expect(boundary.generate).toHaveBeenCalledTimes(4);
  });
  it('retains both rejected candidates privately without changing the bounded replacement', async () => {
    const replacement = { ...intro, about: 'Private replacement explanation.' };
    const replacementVerdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['Private replacement feedback about the grammar rule.'],
        },
      ],
    };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' })
      .mockResolvedValueOnce({
        content: JSON.stringify(replacementVerdict),
        model: 'captured-model',
      });
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const error = await generateClassIntro(params).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(error instanceof TeachingQualityRejectionError)) throw error;
      expect(error.teachingFailure?.reviews.map((review) => JSON.parse(review.candidate!))).toEqual(
        [[intro], [replacement]]
      );
      expect(error.teachingFailure?.reviews.map((review) => review.verdict)).toEqual([
        rejected,
        replacementVerdict,
      ]);
      expect(error.feedback[0].feedback).toEqual(replacementVerdict.items[0].feedback);
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(replacement.about);
      expect(serialized).not.toContain(replacementVerdict.items[0].feedback[0]);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(replacement.about);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        replacementVerdict.items[0].feedback[0]
      );
      expect(boundary.generate).toHaveBeenCalledTimes(4);
    } finally {
      warning.mockRestore();
    }
  });
  it('reviews the exact visible intro without inventing missing visual labels', async () => {
    const result = await generateClassIntro(params);
    const call = boundary.generate.mock.calls[1];
    expect(JSON.parse(call[1][0].content).items).toEqual([{ index: 0, content: result }]);
    expect(call[2]).toMatchObject({ model: 'captured-model', signal: expect.any(AbortSignal) });
    expect(result.examples[0].target).toBe(intro.examples[0].target);
    expect(result.visuals).toBeUndefined();
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
    expect(result.visuals).toBeUndefined();
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

  it('replaces a rejected explanation and preserves feedback identifying its field', async () => {
    const candidate = {
      ...intro,
      examples: [
        {
          target: 'Ich habe einen Kuchen gebacken.',
          meaning: 'Ein Kuchen wurde von mir gebacken.',
          note: 'Bei einen Kuchen backen steht das Perfekt mit haben.',
        },
      ],
    };
    const teachingVerdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: [
            'examples[0].note uses an unquoted infinitive phrase after a preposition. Quote the expression or rewrite the surrounding explanation grammatically.',
          ],
        },
      ],
    };
    const replacement = {
      ...candidate,
      examples: [
        { ...candidate.examples[0], note: 'Das Verb „backen“ bildet das Perfekt mit haben.' },
      ],
    };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(teachingVerdict), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'captured-model' });

    await expect(generateClassIntro(params)).resolves.toMatchObject(replacement);
    expect(boundary.generate.mock.calls[2][2].jsonSchema.name).toBe('class_intro_repair');
    expect(boundary.generate.mock.calls[2][1][0].content).toContain(
      'failed an independent teaching-quality review'
    );
    expect(boundary.generate.mock.calls[2][1][0].content).toContain(
      'Review issue codes: ["incorrect"]'
    );
    expect(boundary.generate.mock.calls[2][1][0].content).toContain(
      teachingVerdict.items[0].feedback[0]
    );
    expect(boundary.generate.mock.calls[2][0]).toContain('Do not return visuals');
    expect(boundary.generate.mock.calls[2][0]).not.toContain('visual aids');
    for (const system of [boundary.generate.mock.calls[0][0], boundary.generate.mock.calls[2][0]]) {
      expect(system).toContain(params.title);
      expect(system).toContain(params.objective);
      expect(system).toContain('Immediate immersion for A2');
    }
    expect(boundary.generate.mock.calls[2][1][0].content).toContain(
      'Correct its teaching meaning, grammar, idiomatic usage, and collocations'
    );
  });

  it('fails closed when the bounded quality replacement is also rejected', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' });

    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate).toHaveBeenCalledTimes(4);
  });

  it('keeps review feedback and malformed output out of diagnostic logs', async () => {
    const privateFeedback = 'Private learner content must never appear in diagnostic logs.';
    const warning = vi.spyOn(logger, 'warn');
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            { index: 0, acceptable: false, issues: ['incorrect'], feedback: [privateFeedback] },
          ],
        }),
        model: 'captured-model',
      })
      .mockResolvedValueOnce({ content: `${privateFeedback}{`, model: 'captured-model' });
    try {
      await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
      expect(JSON.stringify(warning.mock.calls)).not.toContain(privateFeedback);
      expect(warning).toHaveBeenCalledWith('Class intro protocol rejected content', {
        stage: 'replacement',
        reason: 'invalid_json',
      });
    } finally {
      warning.mockRestore();
    }
  });

  it('does not add another replacement after structural repair fails teaching review', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' });

    const error = await generateClassIntro(params).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error.teachingFailure?.reviews).toEqual([
      { candidate: JSON.stringify([intro]), verdict: rejected },
    ]);
    expect(boundary.generate).toHaveBeenCalledTimes(3);
  });

  it('propagates quality replacement provider failure without another call', async () => {
    const error = new Error('authorization denied');
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
    JSON.stringify({ items: [{ index: 1, acceptable: true, issues: [], feedback: [] }] }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: ['incorrect'], feedback: [] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: ['incorrect'], feedback: ['x'.repeat(301)] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: ['incorrect'], feedback: ['   '] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: true, issues: [], feedback: ['Unneeded instruction.'] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: true, issues: ['uncertain'], feedback: [] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: [], feedback: ['Correct the auxiliary.'] }],
    }),
  ])('fails closed on malformed review protocol %s without replacement', async (content) => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content, model: 'captured-model' });
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(boundary.generate.mock.calls).toHaveLength(2);
  });

  it.each([
    JSON.stringify({
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['The example uses the wrong auxiliary.'],
        },
      ],
    }),
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
