import { describe, expect, it } from 'vitest';
import { classTargetsFromSeed } from '@/lib/classes/lesson/class-targets';

describe('class vocabulary targets', () => {
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
