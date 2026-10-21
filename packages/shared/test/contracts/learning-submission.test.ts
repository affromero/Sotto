import { describe, expect, it } from 'vitest';
import { submitClassRequestSchema, startPracticeResponseSchema } from '../../src/contracts/schemas';

describe('learning submission contracts', () => {
  it('allows class completion when writing or speaking provides the graded evidence', () => {
    expect(submitClassRequestSchema.safeParse({ answers: [] }).success).toBe(true);
    expect(submitClassRequestSchema.safeParse({}).success).toBe(false);
  });
  it('preserves a practice reading passage and accepts historical items without one', () => {
    const base = {
      status: 'ready',
      sessionId: 'session',
      kind: 'READING',
      items: [{ id: 'r0', prompt: 'Where is Mia?', options: ['Berlin', 'Bonn'] }],
    };
    expect(startPracticeResponseSchema.safeParse(base).success).toBe(true);
    const withPassage = {
      ...base,
      items: [{ ...base.items[0], passageText: 'Mia ist in Berlin.' }],
    };
    expect(startPracticeResponseSchema.parse(withPassage)).toMatchObject({
      items: [{ passageText: 'Mia ist in Berlin.' }],
    });
  });
});
