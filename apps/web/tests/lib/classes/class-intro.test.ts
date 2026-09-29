import { describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/classes/class-intro');

async function loadClassIntro() {
  vi.resetModules();
  vi.doUnmock('@/lib/classes/class-intro');
  return import('@/lib/classes/class-intro');
}

const FALLBACK = {
  level: 'B1',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Past events',
  objective: 'Tell a short story in the past.',
  grammarPoints: ['perfekt-praeteritum'],
  targetVocab: [
    { lemma: 'zuerst', gloss: 'first' },
    { lemma: 'anschliessend', gloss: 'afterwards' },
  ],
  sourceTitle: null,
};

describe('classIntroFromSeed', () => {
  it.each([
    ['Perfekt for completed activities', 'Präteritum with war and hatte'],
    ['Use als for a past event', 'Use wenn for repeated conditions'],
  ])('preserves stored teaching without inventing visuals from focus %s', async (left, right) => {
    const { classIntroFromSeed } = await loadClassIntro();
    const examples = [
      {
        target: 'Gestern habe ich gearbeitet.',
        meaning: 'Yesterday I worked.',
        note: 'A completed activity.',
      },
      {
        target: 'Gestern war ich zu Hause.',
        meaning: 'Yesterday I was at home.',
        note: 'A past state.',
      },
    ];
    const intro = classIntroFromSeed(
      {
        intro: {
          purpose: 'Describe past events.',
          about: 'Compare two ways to describe yesterday.',
          focus: [left, right],
          examples,
          tips: [left, right],
        },
      },
      FALLBACK
    );
    expect(intro.visuals).toBeUndefined();
    expect(intro.examples).toEqual(examples);
    const restored = classIntroFromSeed(JSON.parse(JSON.stringify({ intro })), FALLBACK);
    expect(restored.visuals).toBeUndefined();
  });
  it('filters duplicate single-word examples and contrast panels', async () => {
    const { classIntroFromSeed } = await loadClassIntro();

    const intro = classIntroFromSeed(
      {
        intro: {
          purpose: 'Tell past events in order.',
          about: 'Use connectors to order a story.',
          focus: ['zuerst -> dann -> schliesslich'],
          examples: [
            { target: 'zuerst', meaning: 'zuerst', note: 'zuerst' },
            { target: 'anschliessend', meaning: 'anschliessend', note: 'anschliessend' },
          ],
          tips: ['Use connectors when the order matters.'],
          visuals: {
            contrast: {
              title: 'Compare the examples',
              leftLabel: 'zuerst',
              leftItems: ['zuerst', 'zuerst'],
              rightLabel: 'anschliessend',
              rightItems: ['anschliessend', 'anschliessend'],
            },
          },
        },
      },
      FALLBACK
    );

    expect(intro.examples).toEqual([]);
    expect(intro.visuals?.contrast).toBeNull();
  });

  it('keeps sentence examples with distinct teaching notes', async () => {
    const { classIntroFromSeed } = await loadClassIntro();

    const intro = classIntroFromSeed(
      {
        intro: {
          purpose: 'Tell past events in order.',
          about: 'Use connectors to order a story.',
          focus: ['zuerst -> dann -> schliesslich'],
          examples: [
            {
              target: 'Zuerst habe ich die Unterlagen vorbereitet.',
              meaning: 'First I prepared the documents.',
              note: 'The connector sets the first event in the sequence.',
            },
          ],
          tips: ['Use connectors when the order matters.'],
        },
      },
      FALLBACK
    );

    expect(intro.examples).toHaveLength(1);
    expect(intro.examples[0]?.target).toContain('Zuerst habe ich');
  });
});
