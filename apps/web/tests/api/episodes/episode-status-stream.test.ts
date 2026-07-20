import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockIsUserAdmin = vi.fn();
const mockSubscribe = vi.fn();
const mockCleanup = vi.fn();
const mockSemaphoreAcquire = vi.fn();
const mockSemaphoreRelease = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  isUserAdmin: (...args: unknown[]) => mockIsUserAdmin(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/redis', () => ({
  createEpisodeStatusSubscriber: () => ({
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    cleanup: (...args: unknown[]) => mockCleanup(...args),
  }),
  semaphore: {
    acquire: (...args: unknown[]) => mockSemaphoreAcquire(...args),
    release: (...args: unknown[]) => mockSemaphoreRelease(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

import { GET } from '@/app/api/v1/episodes/[episodeId]/stream/route';

function request(signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/v1/episodes/episode-1/stream', { signal });
}

const params = { params: Promise.resolve({ episodeId: 'episode-1' }) };

describe('GET episode status stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCleanup.mockResolvedValue(undefined);
    mockSemaphoreAcquire.mockResolvedValue(true);
    mockSemaphoreRelease.mockResolvedValue(undefined);
    mockIsUserAdmin.mockResolvedValue(false);
  });

  it('rejects unauthenticated clients before opening a Redis subscription', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(request(), params);

    expect(response.status).toBe(401);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('does not expose another learner episode status', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-2' });

    const response = await GET(request(), params);

    expect(response.status).toBe(403);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an owner who already has the maximum active streams', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockSemaphoreAcquire.mockResolvedValueOnce(false);

    const response = await GET(request(), params);

    expect(response.status).toBe(429);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('opens a no-cache event stream for the episode owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    const controller = new AbortController();

    const response = await GET(request(controller.signal), params);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(mockSubscribe).toHaveBeenCalledOnce();
    controller.abort();
    expect(mockCleanup).toHaveBeenCalledOnce();
  });
});
