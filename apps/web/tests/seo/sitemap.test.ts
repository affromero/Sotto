import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import sitemap from '@/app/sitemap';

describe('sitemap', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists the static pages on the configured deployment URL', () => {
    const urls = sitemap().map((entry) => entry.url);

    expect(urls).toContain('https://selfhost.example.com');
    expect(urls).toContain('https://selfhost.example.com/about');
    expect(urls).toContain('https://selfhost.example.com/download');
    expect(urls).toContain('https://selfhost.example.com/privacy');
    expect(urls.some((url) => url.startsWith('https://sotto.fm'))).toBe(false);
  });

  it('does not index learner lessons or the retired voices page (private-first)', () => {
    const urls = sitemap().map((entry) => entry.url);

    expect(urls).not.toContain('https://selfhost.example.com/voices');
    expect(urls.some((url) => url.includes('/episode/') || url.includes('/@'))).toBe(false);
  });
});
