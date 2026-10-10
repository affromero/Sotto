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
  it('restores derived immersion meanings without changing their public bytes', async () => {
    const { classIntroFromSeed } = await loadClassIntro();
    const target = 'Ich habe gestern einen Film gesehen.';
    const stored = {
      purpose: 'Erzähle von gestern.',
      about: target,
      focus: ['„Ich habe gestern einen Film gesehen.“: Sehen verwendet hier haben.'],
      examples: [
        {
          target,
          meaning: target,
          note: '„Ich habe gestern einen Film gesehen.“: Sehen verwendet hier haben.',
        },
      ],
      tips: ['„Ich habe gestern einen Film gesehen.“: Nenne den Tag.'],
    };
    expect(classIntroFromSeed({ intro: stored }, { ...FALLBACK, level: 'A2' })).toEqual(stored);
  });
  it('preserves a contextual usage note beside its complete target sentence', async () => {
    const { classIntroFromSeed } = await loadClassIntro();
    const stored = {
      purpose: 'Berichte von einem Ausflug.',
      about: '„Wir sind mit dem Zug gefahren.“: So berichtest du von einer abgeschlossenen Fahrt.',
      focus: ['„Wir sind mit dem Zug gefahren.“: Fahren verwendet hier sein.'],
      examples: [
        {
          target: 'Wir sind mit dem Zug gefahren.',
          meaning: 'So berichtest du von einer abgeschlossenen Fahrt.',
          note: '„Wir sind mit dem Zug gefahren.“: Fahren verwendet hier sein.',
        },
      ],
      tips: ['Nenne das Verkehrsmittel.'],
    };
    expect(classIntroFromSeed({ intro: stored }, { ...FALLBACK, level: 'A2' })).toEqual(stored);
  });
  it('restores useful own-target notes without counting their display quote as teaching content', async () => {
    const { classIntroFromSeed } = await loadClassIntro();
    const stored = {
      purpose: 'Begrüße und erzähle vom Tag.',
      about: 'Begrüßungen und Erlebnisse.',
      focus: ['Grüße am Morgen.'],
      examples: [
        {
          target: 'Guten Morgen',
          meaning: '„Guten Morgen“ sagt man früh am Tag.',
          note: '„Guten Morgen“: Sagt man früh am Tag.',
        },
        { target: 'Wir sind gegangen.', meaning: 'Wir gingen.', note: 'Gehen verwendet sein.' },
      ],
      tips: ['Nenne den Tag.'],
    };
    expect(classIntroFromSeed({ intro: stored }, FALLBACK)).toEqual(stored);
  });
  it.each([
    {
      meaning: 'Sagt man früh am Tag.',
      note: 'Sagt man früh am Tag.',
      name: 'ordinary redundant unprefixed note',
    },
    {
      meaning: 'Eine Begrüßung am Morgen.',
      note: '„Guten Morgen“: ',
      name: 'own-target quote without a note body',
    },
    {
      meaning: 'Eine Begrüßung am Morgen.',
      note: '„Guten Morgen“: Früh.',
      name: 'own-target quote with one-word body',
    },
    {
      meaning: 'Eine Begrüßung am Morgen.',
      note: '„Guten Morgen“: Früh vormittags.',
      name: 'own-target quote with two-word body',
    },
    {
      meaning: '„Guten Abend“ sagt man früh am Tag.',
      note: '„Guten Abend“: Sagt man früh am Tag.',
      name: 'mismatched quote that must remain part of the note',
    },
  ])('filters a stored short example with $name', async ({ meaning, note }) => {
    const { classIntroFromSeed } = await loadClassIntro();
    const useful = {
      target: 'Wir sind gegangen.',
      meaning: 'Wir gingen.',
      note: 'Gehen verwendet sein.',
    };
    const stored = {
      purpose: 'Begrüße und erzähle vom Tag.',
      about: 'Begrüßungen und Erlebnisse.',
      focus: ['Grüße am Morgen.'],
      examples: [{ target: 'Guten Morgen', meaning, note }, useful],
      tips: ['Nenne den Tag.'],
    };
    expect(classIntroFromSeed({ intro: stored }, FALLBACK)).toEqual({
      ...stored,
      examples: [useful],
    });
  });
  it('restores an existing quote without rebinding accepted historical prose to the first example', async () => {
    const { classIntroFromSeed } = await loadClassIntro();
    const stored = {
      purpose: 'Erzähle von gestern.',
      about: '„Wir sind gegangen.“: Gehen verwendet sein.',
      focus: ['Historische Erklärung ohne Beispielzitat.'],
      examples: [
        { target: 'Ich habe gekocht.', meaning: 'Ich kochte.', note: 'Kochen verwendet haben.' },
      ],
      tips: ['„Wir sind gegangen.“: Lerne das Hilfsverb.'],
    };
    expect(classIntroFromSeed({ intro: stored }, FALLBACK)).toEqual(stored);
  });
  it('preserves historical teaching with nineteen review addresses', async () => {
    const { classIntroFromSeed } = await loadClassIntro();
    const stored = {
      purpose: 'Erzähle von gestern.',
      about: 'Das Perfekt beschreibt Vergangenes.',
      focus: Array.from({ length: 6 }, (_, index) => `Fokus ${index}`),
      examples: Array.from({ length: 5 }, () => ({
        target: 'Ich bin gegangen.',
        meaning: 'Ich ging.',
        note: '„Gehen“ verwendet hier „sein“.',
      })),
      tips: Array.from({ length: 5 }, (_, index) => `Tipp ${index}`),
      visuals: { timeline: null, contrast: null, callouts: [], links: [] },
    };
    expect(classIntroFromSeed({ intro: stored }, FALLBACK)).toEqual(stored);
  });
  it('preserves persisted teaching that exceeds the fresh-generation 180-word limit', async () => {
    const { classIntroFromSeed } = await loadClassIntro();
    const stored = {
      purpose: 'Erzähle von gestern.',
      about: Array.from({ length: 164 }, () => 'größer').join(' '),
      focus: ['Perfekt mit sein'],
      examples: [
        { target: 'Ich bin gegangen.', meaning: 'Ich ging.', note: 'Gehen verwendet sein.' },
      ],
      tips: ['Nenne das Ziel.'],
    };

    expect(classIntroFromSeed({ intro: stored }, { ...FALLBACK, level: 'A2' })).toEqual(stored);
  });

  it('preserves an immersion usage note without replacing it with a paraphrase', async () => {
    const { classIntroFromSeed } = await loadClassIntro();
    const example = {
      target: 'Sie hat das Museum besucht.',
      meaning: 'Du erzählst hier von einem Besuch im Museum.',
      note: 'Das Verb „besuchen“ bildet das Perfekt mit „haben“.',
    };
    const stored = {
      purpose: 'Erzähle von gestern.',
      about: 'Mit dem Perfekt erzählst du von Vergangenem.',
      focus: ['Perfekt mit haben'],
      examples: [example],
      tips: ['Achte auf das Hilfsverb.'],
    };
    const restored = classIntroFromSeed({ intro: stored }, { ...FALLBACK, level: 'A2' });
    expect(restored.examples).toEqual([example]);
    expect(restored.visuals).toBeUndefined();
  });
  it.each([
    'Die sprechende Person und ihre Gruppe sind zu Fuß zum Markt gegangen.',
    'Die sprechende Gruppe erzählt, dass sie zu Fuß zum Markt gegangen ist.',
  ])('preserves a stored group explanation: %s', async (meaning) => {
    const { classIntroFromSeed } = await loadClassIntro();
    const example = {
      target: 'Wir sind zu Fuß zum Markt gegangen.',
      meaning,
      note: '„Gehen“ bildet das Perfekt mit „sein“.',
    };
    const restored = classIntroFromSeed(
      {
        intro: {
          purpose: 'Erzähle von gestern.',
          about: 'Mit dem Perfekt erzählst du von Vergangenem.',
          focus: ['Perfekt mit sein'],
          examples: [example],
          tips: ['Achte auf das Hilfsverb.'],
        },
      },
      { ...FALLBACK, level: 'A2' }
    );
    expect(restored.examples).toEqual([example]);
  });
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
