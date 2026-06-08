import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWaitlistWelcomeEmail,
  generateUserUnsubscribeUrl,
} from '@/lib/email-templates';

describe('email templates', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('generates user unsubscribe links for the configured deployment URL', () => {
    expect(generateUserUnsubscribeUrl('user-1')).toMatch(
      /^https:\/\/selfhost\.example\.com\/api\/users\/unsubscribe\?userId=user-1&sig=[a-f0-9]{64}$/
    );
  });

  it('uses the configured deployment URL in waitlist emails', () => {
    const waitlist = buildWaitlistWelcomeEmail('alice@example.com');

    expect(waitlist.html).toContain('https://selfhost.example.com/create');
    expect(waitlist.html).toContain('>selfhost.example.com</a>');
    expect(waitlist.html).not.toContain('https://sotto.fm');
  });
});
