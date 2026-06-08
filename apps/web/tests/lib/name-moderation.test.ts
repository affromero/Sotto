import { describe, expect, it } from 'vitest';
import { moderateDisplayName } from '@/lib/name-moderation';

describe('moderateDisplayName', () => {
  it('accepts normal display names', () => {
    expect(moderateDisplayName('Zephyr Radio')).toEqual({ valid: true });
  });

  it('reuses deterministic display-name validation', () => {
    expect(moderateDisplayName('a')).toEqual({
      valid: false,
      reason: 'Name must be at least 2 characters',
    });
  });

  it('rejects locally blocked content', () => {
    expect(moderateDisplayName('Nazi Host')).toEqual({
      valid: false,
      reason: 'This name contains inappropriate content',
    });
  });

  it('rejects Sotto staff impersonation', () => {
    expect(moderateDisplayName('Sotto Admin')).toEqual({
      valid: false,
      reason: 'This name contains inappropriate content',
    });
  });
});
