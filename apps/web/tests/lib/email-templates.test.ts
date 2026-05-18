import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAnnouncementEmail,
  buildWaitlistWelcomeEmail,
  buildWeeklyDigestEmail,
  generateUserUnsubscribeUrl,
} from '@/lib/email-templates';

describe('email templates', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('generates user unsubscribe links for the configured deployment URL', () => {
    expect(generateUserUnsubscribeUrl('user-1')).toMatch(
      /^https:\/\/selfhost\.example\.com\/api\/users\/unsubscribe\?userId=user-1&sig=[a-f0-9]{64}$/
    );
  });

  it('uses the configured deployment URL in waitlist and announcement emails', () => {
    const waitlist = buildWaitlistWelcomeEmail('alice@example.com');
    const announcement = buildAnnouncementEmail(
      'Product update',
      'New private briefing tools',
      'https://selfhost.example.com/unsubscribe'
    );

    expect(waitlist.html).toContain('https://selfhost.example.com/create');
    expect(waitlist.html).toContain('>selfhost.example.com</a>');
    expect(announcement.html).toContain('https://selfhost.example.com');
    expect(`${waitlist.html}${announcement.html}`).not.toContain('https://sotto.fm');
  });

  it('uses the configured deployment URL for digest podcast and dashboard links', () => {
    const digest = buildWeeklyDigestEmail('alice@example.com', [
      {
        id: 'pod-1',
        title: 'Daily Brief',
        topic: 'Private news',
        slug: 'daily-brief',
        creatorHandle: 'alice',
        creatorName: 'Alice',
      },
    ]);

    expect(digest.html).toContain(
      'https://selfhost.example.com/@alice/daily-brief?utm_source=digest'
    );
    expect(digest.html).toContain('https://selfhost.example.com/dashboard?utm_source=digest');
    expect(digest.html).not.toContain('https://sotto.fm');
  });
});
