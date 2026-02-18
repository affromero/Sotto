import { describe, it, expect } from 'vitest';
import {
  wordCountBounds,
  minutesToWords,
  wordsToMinutes,
  estimateDurationFromText,
  countWords,
  countScriptWords,
} from '@/lib/duration';

describe('duration helpers', () => {
  it('wordCountBounds(10) returns correct bounds', () => {
    const bounds = wordCountBounds(10);
    expect(bounds).toEqual({ target: 1500, min: 1425, max: 1575 });
  });

  it('wordCountBounds(5) returns correct bounds', () => {
    const bounds = wordCountBounds(5);
    expect(bounds).toEqual({ target: 750, min: 675, max: 825 });
  });

  it('minutesToWords(10) returns 1500', () => {
    expect(minutesToWords(10)).toBe(1500);
  });

  it('wordsToMinutes(1500) returns 10', () => {
    expect(wordsToMinutes(1500)).toBe(10);
  });

  it('estimateDurationFromText returns chars / 12.5', () => {
    expect(estimateDurationFromText('x'.repeat(125))).toBe(10);
  });

  it('countWords counts space-separated tokens', () => {
    expect(countWords('hello world foo')).toBe(3);
  });

  it('countScriptWords sums across turns', () => {
    const turns = [{ text: 'hello world' }, { text: 'foo bar baz' }];
    expect(countScriptWords(turns)).toBe(5);
  });
});
