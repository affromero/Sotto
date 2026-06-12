import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEpisodeFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: {
      findMany: (...args: unknown[]) => mockEpisodeFindMany(...args),
    },
  },
}));

import sitemap from '@/app/sitemap';

describe('sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    mockEpisodeFindMany.mockResolvedValue([
      {
        id: 'pod-1',
        slug: 'daily-brief',
        updatedAt: new Date('2026-05-15T10:00:00Z'),
        user: { handle: 'alice' },
      },
      {
        id: 'pod-2',
        slug: null,
        updatedAt: new Date('2026-05-15T11:00:00Z'),
        user: { handle: null },
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the configured deployment URL for all generated entries', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain('https://selfhost.example.com');
    expect(urls).toContain('https://selfhost.example.com/@alice/daily-brief');
    expect(urls).toContain('https://selfhost.example.com/episode/pod-2');
    expect(urls.some((url) => url.startsWith('https://sotto.fm'))).toBe(false);
  });
});
