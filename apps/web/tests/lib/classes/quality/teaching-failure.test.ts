import { describe, expect, it } from 'vitest';
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
