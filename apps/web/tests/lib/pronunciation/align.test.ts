import { describe, it, expect } from 'vitest';
import { normalizeToken, tokenize, alignTokens, alignPhrase } from '@/lib/pronunciation/align';

describe('normalizeToken', () => {
  it('lowercases and strips surrounding punctuation', () => {
    expect(normalizeToken('Straße,')).toBe('straße');
    expect(normalizeToken('"Hallo!"')).toBe('hallo');
  });

  it('keeps apostrophes and digits', () => {
    expect(normalizeToken("don't")).toBe("don't");
    expect(normalizeToken('100%')).toBe('100');
  });
});

describe('tokenize', () => {
  it('splits on whitespace and drops empty tokens', () => {
    expect(tokenize('  Ich   heiße  Anna. ')).toEqual(['ich', 'heiße', 'anna']);
  });
});

describe('alignTokens', () => {
  it('reports a perfect match: full accuracy, zero error', () => {
    const r = alignTokens(['ich', 'heiße', 'anna'], ['ich', 'heiße', 'anna']);
    expect(r.matched).toBe(3);
    expect(r.accuracy).toBe(1);
    expect(r.wordErrorRate).toBe(0);
    expect(r.tokens.every((t) => t.op === 'match')).toBe(true);
  });

  it('detects a single substitution', () => {
    const r = alignTokens(['ich', 'heiße', 'anna'], ['ich', 'heiße', 'emma']);
    expect(r.substitutions).toBe(1);
    expect(r.matched).toBe(2);
    expect(r.accuracy).toBeCloseTo(2 / 3, 5);
    const sub = r.tokens.find((t) => t.op === 'substitute');
    expect(sub).toEqual({ op: 'substitute', expected: 'anna', actual: 'emma' });
  });

  it('detects an omitted (deleted) expected word', () => {
    const r = alignTokens(['ich', 'heiße', 'anna'], ['ich', 'anna']);
    expect(r.deletions).toBe(1);
    expect(r.insertions).toBe(0);
    expect(r.matched).toBe(2);
    const del = r.tokens.find((t) => t.op === 'delete');
    expect(del).toEqual({ op: 'delete', expected: 'heiße' });
  });

  it('detects an extra (inserted) word the learner added', () => {
    const r = alignTokens(['ich', 'heiße', 'anna'], ['ich', 'heiße', 'wirklich', 'anna']);
    expect(r.insertions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.matched).toBe(3);
    expect(r.accuracy).toBe(1); // all expected words were produced
    expect(r.wordErrorRate).toBeCloseTo(1 / 3, 5); // but one extra word counts as error
  });

  it('handles an empty transcript as full deletion', () => {
    const r = alignTokens(['ich', 'heiße', 'anna'], []);
    expect(r.deletions).toBe(3);
    expect(r.matched).toBe(0);
    expect(r.accuracy).toBe(0);
    expect(r.wordErrorRate).toBe(1);
  });

  it('treats empty-expected with empty-actual as trivially correct', () => {
    const r = alignTokens([], []);
    expect(r.accuracy).toBe(1);
    expect(r.wordErrorRate).toBe(0);
  });

  it('caps word error rate at 1 even with many insertions', () => {
    const r = alignTokens(['ja'], ['nein', 'nein', 'nein', 'nein']);
    expect(r.wordErrorRate).toBe(1);
  });
});

describe('alignPhrase', () => {
  it('normalizes case and punctuation before aligning', () => {
    const r = alignPhrase('Ich heiße Anna.', 'ich Heisse anna');
    // "heiße" vs "heisse" is a substitution (ß != ss without transliteration),
    // but "Ich"/"ich" and "Anna."/"anna" match after normalization.
    expect(r.matched).toBe(2);
    expect(r.expectedCount).toBe(3);
  });

  it('scores a close real attempt highly', () => {
    const r = alignPhrase('Wo ist der Bahnhof', 'wo ist der bahnhof');
    expect(r.accuracy).toBe(1);
    expect(r.wordErrorRate).toBe(0);
  });
});
