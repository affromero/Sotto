import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPlayDisplayNameAllowed,
  assertPlaySharedTextAllowed,
  playSafetyContactUrl,
  readPlaySafetyPolicy,
  redactPlayPublishedName,
} from '@/lib/play/safety/policy';

afterEach(() => vi.unstubAllEnvs());
describe('offline game conduct and publication policy', () => {
  it('uses the configured canonical validated operator contact', () => {
    expect(playSafetyContactUrl(undefined)).toBeNull();
    expect(playSafetyContactUrl('')).toBeNull();
    expect(() => playSafetyContactUrl('not an email')).toThrow();
    const url = new URL(playSafetyContactUrl('operator@example.test')!);
    expect(decodeURIComponent(url.pathname)).toBe('operator@example.test');
    expect(url.searchParams.get('subject')).toBe('Sotto game safety');
    vi.stubEnv('SOTTO_PRIVACY_CONTACT_EMAIL', 'operator@example.test');
    expect(readPlaySafetyPolicy()).toMatchObject({
      version: 1,
      termsPath: '/terms',
      privacyPath: '/privacy',
      reviewPath: '/play/safety/review',
    });
  });
  it('filters through canonical local normalization without any provider', () => {
    for (const text of ['f.u.c.k', 'sh1t', 'pórn']) {
      expect(() => assertPlaySharedTextAllowed(text)).toThrow();
      expect(redactPlayPublishedName(text)).toBe('Name hidden');
    }
    expect(() => assertPlayDisplayNameAllowed('Sotto official')).toThrow();
    expect(redactPlayPublishedName('Sotto official')).toBe('Name hidden');
    expect(() => assertPlayDisplayNameAllowed('A')).not.toThrow();
    expect(() => assertPlaySharedTextAllowed('Un café, bitte.')).not.toThrow();
    expect(redactPlayPublishedName(null, 'Host')).toBe('Host');
  });
});
