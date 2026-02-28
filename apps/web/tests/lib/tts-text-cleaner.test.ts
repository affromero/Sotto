import { describe, it, expect } from 'vitest';
import { cleanTextForTts } from '@/lib/tts-text-cleaner';

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
