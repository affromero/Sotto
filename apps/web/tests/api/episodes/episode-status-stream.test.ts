import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockIsUserAdmin = vi.fn();
const mockSubscribe = vi.fn();
const mockCleanup = vi.fn();
const mockCreateSubscriber = vi.fn();
const mockUserAcquire = vi.fn();
const mockGlobalAcquire = vi.fn();
const mockUserRelease = vi.fn();
const mockGlobalRelease = vi.fn();
const mockUserRenew = vi.fn();
const mockGlobalRenew = vi.fn();
const mockOpenSottoSemaphore = vi.fn();

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
  createEpisodeStatusSubscriber: (...args: unknown[]) => mockCreateSubscriber(...args),
}));

vi.mock('@/lib/sidedoor/jobs/core/redis-semaphore', () => ({
  openSottoSemaphore: (...args: unknown[]) => mockOpenSottoSemaphore(...args),
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
    mockOpenSottoSemaphore.mockReset();
    mockUserAcquire.mockReset();
    mockGlobalAcquire.mockReset();
    mockUserRelease.mockReset();
    mockGlobalRelease.mockReset();
    mockUserRenew.mockReset();
    mockGlobalRenew.mockReset();
    mockCreateSubscriber.mockReset();
    mockCreateSubscriber.mockReturnValue({
      subscribe: (...args: unknown[]) => mockSubscribe(...args),
      cleanup: (...args: unknown[]) => mockCleanup(...args),
    });
    mockSubscribe.mockResolvedValue(undefined);
    mockCleanup.mockResolvedValue(undefined);
    mockUserAcquire.mockResolvedValue(true);
    mockGlobalAcquire.mockResolvedValue(true);
    mockUserRelease.mockResolvedValue(undefined);
    mockGlobalRelease.mockResolvedValue(undefined);
    mockUserRenew.mockResolvedValue(true);
    mockGlobalRenew.mockResolvedValue(true);
    mockOpenSottoSemaphore
      .mockResolvedValueOnce({
        acquire: mockUserAcquire,
        release: mockUserRelease,
        renew: mockUserRenew,
      })
      .mockResolvedValueOnce({
        acquire: mockGlobalAcquire,
        release: mockGlobalRelease,
        renew: mockGlobalRenew,
      });
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
    mockUserAcquire.mockResolvedValueOnce(false);

    const response = await GET(request(), params);

    expect(response.status).toBe(429);
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalAcquire).not.toHaveBeenCalled();
  });

  it('releases user capacity when the global stream limit is full', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockGlobalAcquire.mockResolvedValueOnce(false);

    const response = await GET(request(), params);

    expect(response.status).toBe(503);
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalRelease).toHaveBeenCalledOnce();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('releases both tokens when subscriber creation fails', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    const failure = new Error('Subscriber unavailable');
    mockCreateSubscriber.mockImplementationOnce(() => {
      throw failure;
    });

    await expect(GET(request(), params)).rejects.toBe(failure);
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalRelease).toHaveBeenCalledOnce();
  });

  it('does not open capacity for an already aborted request', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    const controller = new AbortController();
    const reason = new Error('Client left');
    controller.abort(reason);

    await expect(GET(request(controller.signal), params)).rejects.toBe(reason);
    expect(mockOpenSottoSemaphore).not.toHaveBeenCalled();
    expect(mockCreateSubscriber).not.toHaveBeenCalled();
  });

  it('releases an opened session when cancellation wins during admission', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    const controller = new AbortController();
    const reason = new Error('Client left during admission');
    mockOpenSottoSemaphore.mockReset().mockImplementationOnce(async () => {
      controller.abort(reason);
      return { acquire: mockUserAcquire, release: mockUserRelease, renew: mockUserRenew };
    });

    await expect(GET(request(controller.signal), params)).rejects.toBe(reason);
    expect(mockUserAcquire).not.toHaveBeenCalled();
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockCreateSubscriber).not.toHaveBeenCalled();
  });

  it('releases subscriber and capacity when Redis subscription fails', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    const failure = new Error('Subscription rejected');
    mockSubscribe.mockRejectedValueOnce(failure);

    await expect(GET(request(), params)).rejects.toBe(failure);
    expect(mockCleanup).toHaveBeenCalledOnce();
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalRelease).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight Redis subscription and releases capacity', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    const controller = new AbortController();
    let subscriptionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      subscriptionStarted = resolve;
    });
    mockSubscribe.mockImplementationOnce(
      async (_onMessage: unknown, options: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
          subscriptionStarted();
        })
    );
    const pending = GET(request(controller.signal), params);
    await started;
    const reason = new Error('Client left while Redis was unavailable');
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(mockCleanup).toHaveBeenCalledOnce();
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalRelease).toHaveBeenCalledOnce();
  });

  it('errors the stream and releases capacity when its Redis subscriber is lost', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
    let onLoss!: (error: Error) => void;
    mockSubscribe.mockImplementationOnce(
      async (_onMessage: unknown, options: { onLoss: (error: Error) => void }) => {
        onLoss = options.onLoss;
      }
    );
    const response = await GET(request(), params);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    const failure = new Error('Redis subscriber ended');
    onLoss(failure);

    await expect(reader.read()).rejects.toBe(failure);
    expect(mockCleanup).toHaveBeenCalledOnce();
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalRelease).toHaveBeenCalledOnce();
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
    await expect.poll(() => mockCleanup.mock.calls.length).toBe(1);
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalRelease).toHaveBeenCalledOnce();
  });

  it('releases both capacity tokens when the response body is cancelled', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });

    const response = await GET(request(), params);
    await response.body?.cancel();

    expect(mockCleanup).toHaveBeenCalledOnce();
    expect(mockUserRelease).toHaveBeenCalledOnce();
    expect(mockGlobalRelease).toHaveBeenCalledOnce();
  });

  it('errors the stream and releases both tokens when capacity renewal fails', async () => {
    vi.useFakeTimers();
    try {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
      const failure = new Error('Redis session lost');
      mockUserRenew.mockRejectedValueOnce(failure);

      const response = await GET(request(), params);
      const reader = response.body!.getReader();
      expect((await reader.read()).done).toBe(false);
      const pending = reader.read();
      await vi.advanceTimersByTimeAsync(30_000);

      expect((await pending).done).toBe(false);
      await expect(reader.read()).rejects.toBe(failure);
      expect(mockCleanup).toHaveBeenCalledOnce();
      expect(mockUserRelease).toHaveBeenCalledOnce();
      expect(mockGlobalRelease).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
