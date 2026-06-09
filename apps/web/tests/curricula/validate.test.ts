import { describe, it, expect } from 'vitest';
import { loadAllCurricula } from '../../prisma/curricula/schema';

// loadAllCurricula() throws if any course.json / lesson JSON fails the Zod
// contract or the ordering/slug invariants, so loading itself is the validation.
// The three hand-authored curricula are the seeded "reference quality" set; any
// other pair is composed by the agent at runtime.
const SEEDED = ['en->de', 'en->es', 'es->en'];

describe('curriculum content', () => {
  const curricula = loadAllCurricula();

  it('ships the seeded reference curricula', () => {
    const pairs = curricula.map((c) => `${c.manifest.nativeLang}->${c.manifest.targetLang}`).sort();
    expect(pairs).toEqual([...SEEDED].sort());
  });

  for (const c of curricula) {
    const id = `${c.manifest.nativeLang}->${c.manifest.targetLang}`;
    it(`${id}: has lessons with contiguous order and non-empty content`, () => {
      expect(c.lessons.length).toBeGreaterThan(0);

      const orders = c.lessons.map((l) => l.order).sort((a, b) => a - b);
      orders.forEach((o, i) => expect(o).toBe(i + 1));

      for (const lesson of c.lessons) {
        expect(lesson.objective.length).toBeGreaterThan(0);
        expect(lesson.grammarPoints.length).toBeGreaterThan(0);
        expect(lesson.targetVocab.length).toBeGreaterThan(0);
        expect(lesson.level).toMatch(/^[ABC][12]$/);
      }
    });
  }
});
