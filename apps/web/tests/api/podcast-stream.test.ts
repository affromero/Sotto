import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockSubscribe = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/redis', () => ({
  createPodcastStatusSubscriber: vi.fn(() => ({
    subscribe: mockSubscribe,
    unsubscribe: vi.fn(),
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { createPodcastStatusSubscriber } from '@/lib/redis';
import { GET } from '@/app/api/podcasts/[podcastId]/stream/route';

function createRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/stream'));
}

describe('GET /api/podcasts/[podcastId]/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockPodcastFindUnique).not.toHaveBeenCalled();
    expect(createPodcastStatusSubscriber).not.toHaveBeenCalled();
  });

  it('returns 404 when the podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Podcast not found');
    expect(createPodcastStatusSubscriber).not.toHaveBeenCalled();
  });

  it('forbids non-owner subscribers', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-2' });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(createPodcastStatusSubscriber).not.toHaveBeenCalled();
  });

  it('opens a stream for the owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(createPodcastStatusSubscriber).toHaveBeenCalledWith('pod-1');
    expect(mockSubscribe).toHaveBeenCalled();
  });
});
