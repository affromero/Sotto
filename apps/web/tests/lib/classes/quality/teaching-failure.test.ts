import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  captureTeachingFailure,
  teachingFailureSchema,
  teachingQualityVerdictSchema,
  retainTeachingFailure,
  retainedTeachingFailure,
} from '@/lib/classes/quality/teaching-failure';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';

const verdict = teachingQualityVerdictSchema.parse({
  items: [
    {
      index: 0,
      acceptable: false,
      issues: ['incorrect'],
      feedback: ['The auxiliary contradicts the movement example.'],
    },
  ],
});

describe('private teaching failure evidence', () => {
  it('preserves actual review evidence privately without changing a provider error or its category', () => {
    const error = new Error('Private provider failure');
    const failure = captureTeachingFailure(
      'intro',
      [{ about: 'Private original teaching' }],
      verdict
    );
    const expected = structuredClone(failure);
    retainTeachingFailure(error, failure);
    failure.reviews[0]!.candidate = 'Mutated caller data';
    const captured = captureGenerationFailure(error);
    expect(captured).toEqual({ category: 'generation_failed', teachingFailure: expected });
    expect(error.message).toBe('Private provider failure');
    expect(JSON.stringify(error)).not.toContain('Private original teaching');
    captured.teachingFailure!.reviews[0]!.candidate = 'Mutated returned data';
    expect(retainedTeachingFailure(error)).toEqual(expected);
    expect(retainedTeachingFailure(new Error('Unrelated'))).toBeUndefined();
  });
  it('keeps complete reviewed content and the independently validated verdict', () => {
    const candidate = { about: 'A private generated teaching explanation.', examples: [] };
    const evidence = captureTeachingFailure('intro', [candidate], verdict);
    expect(JSON.parse(evidence.reviews[0].candidate!)).toEqual([candidate]);
    expect(evidence.reviews[0].verdict).toEqual(verdict);
  });

  it('preserves every intro address including a rejection in the final batch', () => {
    const items = Array.from({ length: 19 }, (_, index) => ({
      index,
      acceptable: index !== 18,
      issues: index === 18 ? ['unsupported' as const] : [],
      feedback: index === 18 ? ['The visual introduces an unsupported event.'] : [],
    }));
    const reviewed = items.map(({ index }) => ({ address: `private address ${index}` }));
    const evidence = captureTeachingFailure('intro', reviewed, { items });
    expect(JSON.parse(evidence.reviews[0].candidate!)).toEqual(reviewed);
    expect(evidence.reviews[0].verdict.items).toEqual(items);
    const error = new Error('Provider failure after review');
    retainTeachingFailure(error, evidence);
    expect(captureGenerationFailure(error)).toEqual({
      category: 'generation_failed',
      teachingFailure: evidence,
    });
    expect(JSON.stringify(error)).not.toContain('private address');
    expect(() => captureTeachingFailure('writing', reviewed, { items })).toThrow(z.ZodError);
  });

  it('reads historical complete intro verdicts whose indices arrived out of order', () => {
    const shuffled = {
      items: [{ index: 1, acceptable: true, issues: [], feedback: [] }, ...verdict.items],
    };
    const stored = {
      kind: 'intro',
      reviews: [
        { candidate: JSON.stringify([{ about: 'Historical private intro' }]), verdict: shuffled },
      ],
    };
    expect(teachingFailureSchema.parse(stored)).toEqual(stored);
  });

  it('rejects aggregate intro evidence with missing or duplicate address indices', () => {
    const evidence = captureTeachingFailure('intro', [{ about: 'Reviewed intro' }], verdict);
    for (const indices of [
      [0, 0],
      [0, 2],
    ]) {
      const invalid = {
        ...evidence,
        reviews: [
          {
            ...evidence.reviews[0],
            verdict: { items: indices.map((index) => ({ ...verdict.items[0], index })) },
          },
        ],
      };
      expect(teachingFailureSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('omits an oversized multibyte candidate while retaining the rejection verdict', () => {
    const evidence = captureTeachingFailure('intro', [{ about: '語'.repeat(12000) }], verdict);
    expect(evidence.reviews).toEqual([{ candidate: null, omitted: 'size_limit', verdict }]);
  });

  it('rejects stored oversized content, unexplained omission and excessive review history', () => {
    const valid = captureTeachingFailure('intro', [{ about: 'Reviewed teaching.' }], verdict);
    expect(
      teachingFailureSchema.safeParse({
        kind: 'intro',
        reviews: [{ candidate: '語'.repeat(12000), verdict }],
      }).success
    ).toBe(false);
    expect(
      teachingFailureSchema.safeParse({
        kind: 'intro',
        reviews: [{ candidate: null, verdict }],
      }).success
    ).toBe(false);
    expect(
      teachingFailureSchema.safeParse({
        ...valid,
        reviews: [...valid.reviews, ...valid.reviews, ...valid.reviews],
      }).success
    ).toBe(false);
  });
});
