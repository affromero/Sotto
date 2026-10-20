import { describe, expect, it } from 'vitest';
import {
  selectVocabularyTargets,
  type VocabularyMemory,
} from '@/lib/learning/vocabulary/selection';

const now = new Date('2026-10-20T12:00:00Z');
const candidates = Array.from({ length: 12 }, (_, index) => ({
  lemma: `new${index}`,
  gloss: `new word ${index}`,
}));
function word(lemma: string, overrides: Partial<VocabularyMemory> = {}): VocabularyMemory {
  return {
    lemma,
    translation: `${lemma} translation`,
    partOfSpeech: null,
    mastery: 0.2,
    reps: 1,
    lastReviewed: new Date('2026-10-19T12:00:00Z'),
    firstSeenClassId: null,
    dueAt: now,
    ...overrides,
  };
}
function select(memory: VocabularyMemory[], due = memory, fresh = candidates) {
  return selectVocabularyTargets(fresh, due, memory, 8, now);
}

describe('adaptive vocabulary selection', () => {
  it('uses the ranked dictionary backlog before introducing words while recall is weak', () => {
    const memory = Array.from({ length: 10 }, (_, index) => word(`weak${index}`));
    const due = [...memory].reverse();
    expect(select(memory, due).map(({ lemma }) => lemma)).toEqual(
      due.slice(0, 8).map(({ lemma }) => lemma)
    );
  });

  it('gradually introduces more words as the active vocabulary becomes solid', () => {
    const countNew = (mastery: number) =>
      select([word('review', { mastery })]).filter(({ lemma }) => lemma.startsWith('new')).length;
    expect(countNew(0.2)).toBe(0);
    expect(countNew(0.68)).toBe(2);
    expect(countNew(0.85)).toBe(4);
  });

  it('keeps partially learned words active even when their scheduled review is in the future', () => {
    const memory = [word('learning', { mastery: 0.6, dueAt: new Date('2026-11-01') })];
    expect(select(memory, []).map(({ lemma }) => lemma)).toEqual(['learning', 'new0']);
  });

  it('retains overdue mastered words when new words are introduced', () => {
    const memory = [word('known', { mastery: 0.95 })];
    expect(select(memory).map(({ lemma }) => lemma)).toEqual([
      'known',
      'new0',
      'new1',
      'new2',
      'new3',
    ]);
  });

  it('starts from the unassessed dictionary queue before new curriculum candidates', () => {
    const memory = Array.from({ length: 10 }, (_, index) =>
      word(`imported${index}`, { mastery: 0, reps: 0, lastReviewed: null })
    );
    expect(select(memory).map(({ lemma }) => lemma)).toEqual([
      'imported0',
      'imported1',
      'imported2',
      'imported3',
    ]);
  });

  it.each([
    { reps: 1, lastReviewed: null, firstSeenClassId: null },
    { reps: 0, lastReviewed: now, firstSeenClassId: null },
    { reps: 0, lastReviewed: null, firstSeenClassId: 'class-1' },
    { reps: 0, lastReviewed: null, firstSeenClassId: null, introducedAt: now },
  ])('keeps introduced words active until recall is solid: %j', (provenance) => {
    const memory = [
      word('taught', {
        mastery: 0,
        ...provenance,
      }),
    ];
    expect(select(memory).map(({ lemma }) => lemma)).toEqual(['taught']);
  });

  it('does not let a large mastered history conceal the weakest active words', () => {
    const memory = [
      ...Array.from({ length: 100 }, (_, index) => word(`known${index}`, { mastery: 1 })),
      ...Array.from({ length: 8 }, (_, index) => word(`weak${index}`)),
    ];
    expect(select(memory, memory.slice(-8)).every(({ lemma }) => lemma.startsWith('weak'))).toBe(
      true
    );
  });

  it('does not repeat mastered words before they are due', () => {
    const memory = [word('known', { mastery: 0.95, dueAt: new Date('2026-11-01') })];
    expect(select(memory, [], []).map(({ lemma }) => lemma)).toEqual([]);
  });

  it('reviews dictionary words outside the currently sampled source and retains their translation', () => {
    expect(
      select([word('Bahnhof')], [word('Bahnhof')], [{ lemma: 'Fahrkarte', gloss: 'ticket' }])
    ).toEqual([{ lemma: 'Bahnhof', gloss: 'Bahnhof translation' }]);
  });

  it('deduplicates new dictionary and source candidates within the introduction budget', () => {
    const memory = [word('new0', { mastery: 0, reps: 0, lastReviewed: null })];
    expect(select(memory).map(({ lemma }) => lemma)).toEqual(['new0', 'new1', 'new2', 'new3']);
  });
});
