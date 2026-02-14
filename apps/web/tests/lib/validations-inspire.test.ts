import { describe, it, expect } from 'vitest';
import { onboardingInterestsSchema, inspireDrillSchema } from '@/lib/validations';

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

  it('rejects array over 12 items', () => {
    const tagIds = Array.from({ length: 13 }, (_, i) => `tag-${i}`);
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

describe('inspireDrillSchema', () => {
  it('accepts category only', () => {
    const result = inspireDrillSchema.safeParse({ category: 'Technology' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('Technology');
      expect(result.data.parentTitle).toBeUndefined();
    }
  });

  it('accepts category + parentTitle', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'Technology',
      parentTitle: 'AI and Machine Learning',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('Technology');
      expect(result.data.parentTitle).toBe('AI and Machine Learning');
    }
  });

  it('rejects empty category', () => {
    const result = inspireDrillSchema.safeParse({ category: '' });
    expect(result.success).toBe(false);
  });

  it('rejects category over 200 chars', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('accepts category at exactly 200 chars', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'a'.repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty parentTitle when provided', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'Technology',
      parentTitle: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects parentTitle over 200 chars', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'Technology',
      parentTitle: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('accepts parentTitle at exactly 200 chars', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'Technology',
      parentTitle: 'a'.repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing category', () => {
    const result = inspireDrillSchema.safeParse({
      parentTitle: 'Some Parent Title',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string category', () => {
    const result = inspireDrillSchema.safeParse({
      category: 123,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string parentTitle', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'Technology',
      parentTitle: 123,
    });
    expect(result.success).toBe(false);
  });

  it('accepts single character category', () => {
    const result = inspireDrillSchema.safeParse({ category: 'A' });
    expect(result.success).toBe(true);
  });

  it('accepts single character parentTitle', () => {
    const result = inspireDrillSchema.safeParse({
      category: 'Technology',
      parentTitle: 'A',
    });
    expect(result.success).toBe(true);
  });
});
