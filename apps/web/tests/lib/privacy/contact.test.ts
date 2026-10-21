import { describe, expect, it } from 'vitest';
import { privacyContactUrl } from '@/lib/privacy/contact';

describe('public privacy operator contact', () => {
  it.each([undefined, '', '  '])('does not invent an operator destination for %s', (value) => {
    expect(privacyContactUrl(value)).toBeNull();
  });

  it('directs deletion requests to the configured operator with one fixed subject', () => {
    const url = new URL(privacyContactUrl(' operator+privacy@example.com ')!);
    expect(decodeURIComponent(url.pathname)).toBe('operator+privacy@example.com');
    expect([...url.searchParams]).toEqual([['subject', 'Sotto profile deletion']]);
  });

  it.each([
    'not-an-email',
    'operator@example.com\r\nBcc:other@example.com',
    'operator@example.com?bcc=other@example.com',
  ])('rejects invalid configured contact rather than routing it elsewhere', (value) => {
    expect(() => privacyContactUrl(value)).toThrow();
  });
});
