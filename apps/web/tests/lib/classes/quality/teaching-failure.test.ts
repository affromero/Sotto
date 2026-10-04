import { describe, expect, it } from 'vitest';
import {
  captureTeachingFailure,
  teachingFailureSchema,
  teachingQualityVerdictSchema,
} from '@/lib/classes/quality/teaching-failure';

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
