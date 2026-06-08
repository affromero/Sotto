import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockPodcastFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
  },
}));

import { GET } from '@/app/api/oembed/route';

function request(url: string): NextRequest {
  return new NextRequest(url);
}

describe('GET /api/oembed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    mockPodcastFindUnique.mockResolvedValue({
      id: 'pod-1',
      title: 'Private Briefing',
      status: 'READY',
      visibility: 'PUBLIC',
      user: { name: 'Alice' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns embed metadata with the configured deployment URL', async () => {
    const response = await GET(
      request(
        'https://selfhost.example.com/api/oembed?url=https%3A%2F%2Fselfhost.example.com%2Fpodcast%2Fpod-1'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.provider_url).toBe('https://selfhost.example.com');
    expect(body.thumbnail_url).toBe('https://selfhost.example.com/podcast/pod-1/opengraph-image');
    expect(body.html).toContain('https://selfhost.example.com/podcast/pod-1/embed');
    expect(JSON.stringify(body)).not.toContain('https://sotto.fm');
  });

  it('rejects URLs for a different origin', async () => {
    const response = await GET(
      request(
        'https://selfhost.example.com/api/oembed?url=https%3A%2F%2Fexample.net%2Fpodcast%2Fpod-1'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid podcast URL' });
    expect(mockPodcastFindUnique).not.toHaveBeenCalled();
  });
});
