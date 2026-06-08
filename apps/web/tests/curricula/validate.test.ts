import { describe, it, expect } from 'vitest';
import { loadAllCurricula, LANGUAGE_PAIRS } from '../../prisma/curricula/schema';

// loadAllCurricula() throws if any course.json / lesson JSON fails the Zod
// contract or the ordering/slug invariants, so loading itself is the validation.
describe('curriculum content', () => {
  const curricula = loadAllCurricula();

  it('ships a curriculum for all three v1 language pairs', () => {
    const pairs = curricula.map((c) => c.manifest.pair).sort();
    expect(pairs).toEqual([...LANGUAGE_PAIRS].sort());
  });

  for (const pair of LANGUAGE_PAIRS) {
    it(`${pair}: has lessons with contiguous order and non-empty content`, () => {
      const c = curricula.find((x) => x.manifest.pair === pair);
      expect(c, `missing curriculum for ${pair}`).toBeDefined();
      expect(c!.lessons.length).toBeGreaterThan(0);

      const orders = c!.lessons.map((l) => l.order).sort((a, b) => a - b);
      orders.forEach((o, i) => expect(o).toBe(i + 1));

      for (const lesson of c!.lessons) {
        expect(lesson.objective.length).toBeGreaterThan(0);
        expect(lesson.grammarPoints.length).toBeGreaterThan(0);
        expect(lesson.targetVocab.length).toBeGreaterThan(0);
        expect(lesson.level).toMatch(/^[ABC][12]$/);
      }
    });
  }
});
