import { describe, it, expect } from 'vitest';
import { cleanTextForTts, splitTextForTts } from '@/lib/tts-text-cleaner';

describe('tts-text-cleaner', () => {
  it('strips SFX markers', () => {
    expect(cleanTextForTts('[SFX: upbeat music, 3s] Hello there'))
      .toBe('Hello there');
  });

  it('strips citation markers', () => {
    expect(cleanTextForTts('According to a study [1], this works [2, 3].'))
      .toBe('According to a study, this works.');
  });

  it('collapses multiple spaces', () => {
    expect(cleanTextForTts('Hello   there   friend'))
      .toBe('Hello there friend');
  });

  it('preserves clean text', () => {
    expect(cleanTextForTts('This is perfectly normal text.'))
      .toBe('This is perfectly normal text.');
  });

  it('handles combined SFX + citation markers', () => {
    expect(cleanTextForTts('[SFX: whoosh] A study [1] found [SFX: ding] results [2, 3].'))
      .toBe('A study found results.');
  });
});

describe('splitTextForTts', () => {
  it('returns single chunk when text is under 80% of limit', () => {
    const text = 'Short text.';
    expect(splitTextForTts(text, 5000)).toEqual([text]);
  });

  it('returns single chunk at exactly 80% of limit', () => {
    const text = 'A'.repeat(4000);
    expect(splitTextForTts(text, 5000)).toEqual([text]);
  });

  it('splits at sentence boundary when text exceeds limit', () => {
    // Two sentences, each ~2500 chars, total exceeds 80% of 5000 = 4000
    const sentence1 = 'A'.repeat(2498) + '.';
    const sentence2 = 'B'.repeat(2498) + '.';
    const text = `${sentence1} ${sentence2}`;
    const chunks = splitTextForTts(text, 5000);

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(sentence1);
    expect(chunks[1]).toBe(sentence2);
  });

  it('splits at comma when no sentence boundary in range', () => {
    // One long clause with a comma in the middle, no periods
    const part1 = 'A'.repeat(2000) + ',';
    const part2 = 'B'.repeat(2500);
    const text = `${part1} ${part2}`;
    const chunks = splitTextForTts(text, 5000);

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(part1);
    expect(chunks[1]).toBe(part2);
  });

  it('splits at word boundary as last resort', () => {
    // Long text with spaces but no punctuation — must exceed 80% of limit
    const words = Array(1000).fill('wordword').join(' ');
    const chunks = splitTextForTts(words, 5000);

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should end at a word boundary (no partial words)
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/^\s/);
      expect(chunk).not.toMatch(/\s$/);
    }
  });

  it('produces chunks all under the maxChars limit', () => {
    const text = Array(100).fill('This is a fairly long sentence that keeps going. ').join('');
    const maxChars = 5000;
    const chunks = splitTextForTts(text, maxChars);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars);
    }
  });

  it('preserves all text content across chunks', () => {
    const text = Array(50).fill('Hello world. ').join('').trim();
    const chunks = splitTextForTts(text, 200);

    const reconstructed = chunks.join(' ');
    // All original words should be present
    expect(reconstructed.replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });
});
