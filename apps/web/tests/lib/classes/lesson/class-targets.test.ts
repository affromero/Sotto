import { describe, expect, it } from 'vitest';
import { classTargetsFromSeed, selectClassVocabulary } from '@/lib/classes/lesson/class-targets';

describe('class vocabulary targets', () => {
  it('reserves new words alongside genuinely struggling words in the canonical due order', () => {
    const fresh = Array.from({ length: 7 }, (_, index) => ({
      lemma: 'new' + index,
      gloss: 'new word ' + index,
    }));
    const weak = Array.from({ length: 6 }, (_, index) => ({
      lemma: 'weak' + index,
      translation: 'review word ' + index,
      mastery: 0.2,
    }));
    const memory = weak.map((word) => ({ ...word, reps: 1, lastReviewed: new Date('2026-01-01') }));
    const selected = selectClassVocabulary(fresh, weak, memory, false);
    expect(selected).toHaveLength(8);
    expect(selected.slice(0, 4).map(({ lemma }) => lemma)).toEqual(
      weak.slice(0, 4).map(({ lemma }) => lemma)
    );
    expect(selected.slice(4)).toEqual(fresh.slice(0, 4));
  });

  it('uses imported source words instead of unrelated curriculum or memory words', () => {
    const imported = [
      { lemma: 'Bahnhof', gloss: 'station' },
      { lemma: 'Fahrkarte', gloss: 'ticket' },
    ];
    const selected = selectClassVocabulary(
      imported,
      [
        { lemma: 'unrelated', translation: 'unrelated', mastery: 0.1 },
        { lemma: 'Bahnhof', translation: 'station', mastery: 0.2 },
      ],
      [
        { lemma: 'unrelated', mastery: 0.1, reps: 1, lastReviewed: new Date('2026-01-01') },
        { lemma: 'Bahnhof', mastery: 0.2, reps: 1, lastReviewed: new Date('2026-01-01') },
      ],
      true
    );
    expect(selected).toEqual(imported);
  });

  it('treats an imported but unreviewed word as new and does not select a mastered word as struggling', () => {
    const selected = selectClassVocabulary(
      [
        { lemma: 'new', gloss: 'new' },
        { lemma: 'known', gloss: 'known' },
      ],
      [{ lemma: 'known', translation: 'known', mastery: 0.9 }],
      [
        { lemma: 'new', mastery: 0, reps: 0, lastReviewed: null },
        { lemma: 'known', mastery: 0.9, reps: 4, lastReviewed: new Date('2026-01-01') },
      ],
      true
    );
    expect(selected).toEqual([{ lemma: 'new', gloss: 'new' }]);
  });

  it('keeps the exact saved selection for repair and rejects a malformed saved selection', () => {
    const classTargets = {
      vocab: [{ lemma: 'Bahnhof', gloss: 'station' }],
      grammarPoints: ['past'],
    };
    expect(classTargetsFromSeed({ classTargets })).toEqual(classTargets);
    expect(classTargetsFromSeed({ intro: {} })).toBeUndefined();
    expect(() =>
      classTargetsFromSeed({ classTargets: { vocab: [{ lemma: '', gloss: 'missing' }] } })
    ).toThrow();
  });
});
