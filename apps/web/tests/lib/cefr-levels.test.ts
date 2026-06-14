import { describe, it, expect } from 'vitest';
import { CEFR_ORDER, cefrRank, higherLevel } from '@/lib/cefr-levels';

describe('cefr-levels', () => {
  it('orders the ladder A1 < A2 < B1 < B2 < C1 < C2', () => {
    expect(CEFR_ORDER).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(cefrRank('A1')).toBe(0);
    expect(cefrRank('B2')).toBe(3);
    expect(cefrRank('C2')).toBe(5);
  });

  it('higherLevel returns the higher of two levels', () => {
    expect(higherLevel('B2', 'A2')).toBe('B2');
    expect(higherLevel('A1', 'B1')).toBe('B1');
    expect(higherLevel('C1', 'B2')).toBe('C1');
  });

  it('higherLevel returns the first argument on a tie', () => {
    expect(higherLevel('B1', 'B1')).toBe('B1');
  });
});
