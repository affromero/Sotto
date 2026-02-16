import { describe, it, expect } from 'vitest';
import { onboardingInterestsSchema } from '@/lib/validations';

describe('onboardingInterestsSchema', () => {
  it('accepts empty array', () => {
    const result = onboardingInterestsSchema.safeParse({ tagIds: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual([]);
    }
  });

  it('accepts array of tag IDs', () => {
    const result = onboardingInterestsSchema.safeParse({
      tagIds: ['tag-1', 'tag-2', 'tag-3'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual(['tag-1', 'tag-2', 'tag-3']);
    }
  });

  it('accepts exactly 12 items', () => {
    const tagIds = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
    const result = onboardingInterestsSchema.safeParse({ tagIds });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toHaveLength(12);
    }
  });

  it('rejects array over 20 items', () => {
    const tagIds = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const result = onboardingInterestsSchema.safeParse({ tagIds });
    expect(result.success).toBe(false);
  });

  it('rejects non-string items', () => {
    const result = onboardingInterestsSchema.safeParse({
      tagIds: ['tag-1', 123, 'tag-3'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing tagIds field', () => {
    const result = onboardingInterestsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-array tagIds', () => {
    const result = onboardingInterestsSchema.safeParse({ tagIds: 'not-an-array' });
    expect(result.success).toBe(false);
  });

  it('rejects null tagIds', () => {
    const result = onboardingInterestsSchema.safeParse({ tagIds: null });
    expect(result.success).toBe(false);
  });

  it('accepts array with single tag ID', () => {
    const result = onboardingInterestsSchema.safeParse({ tagIds: ['tag-1'] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual(['tag-1']);
    }
  });
});
