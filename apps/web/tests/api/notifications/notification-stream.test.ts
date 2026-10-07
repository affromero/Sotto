import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockSubscribe = vi.fn();
const mockCleanup = vi.fn();
const mockCreateSubscriber = vi.fn();
let mockShutdownController = new AbortController();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));
vi.mock('@/lib/redis', () => ({
  createNotificationSubscriber: (...args: unknown[]) => mockCreateSubscriber(...args),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/sse/shutdown', () => ({
  getSseShutdownSignal: () => mockShutdownController.signal,
}));

import { GET } from '@/app/api/v1/notifications/stream/route';

function request(signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/v1/notifications/stream', { signal });
}

describe('GET notification stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShutdownController = new AbortController();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockSubscribe.mockResolvedValue(undefined);
    mockCleanup.mockResolvedValue(undefined);
    mockCreateSubscriber.mockReturnValue({
      subscribe: (...args: unknown[]) => mockSubscribe(...args),
      cleanup: (...args: unknown[]) => mockCleanup(...args),
    });
  });

  it('rejects an aborted request before opening a subscriber', async () => {
    const controller = new AbortController();
    const reason = new Error('Client left');
    controller.abort(reason);

    await expect(GET(request(controller.signal))).rejects.toBe(reason);
    expect(mockCreateSubscriber).not.toHaveBeenCalled();
  });

  it('preserves client cancellation and cleans up once if shutdown follows', async () => {
    const client = new AbortController();
    const response = await GET(request(client.signal));
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    const reason = new Error('Client left');

    client.abort(reason);
    await expect(reader.read()).rejects.toBe(reason);

    mockShutdownController.abort(new Error('Server is shutting down'));
    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('closes the subscriber when subscription fails', async () => {
    const failure = new Error('Subscription failed');
    mockSubscribe.mockRejectedValueOnce(failure);

    await expect(GET(request())).rejects.toBe(failure);
    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('delivers an event received while the response stream is being initialized', async () => {
    mockSubscribe.mockImplementationOnce(async (onMessage: (data: string) => void) => {
      onMessage('{"kind":"ready"}');
    });

    const response = await GET(request());
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    expect(decoder.decode((await reader.read()).value)).toContain(': connected');
    expect(decoder.decode((await reader.read()).value)).toContain('{"kind":"ready"}');
    await reader.cancel();
    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('confirms subscriber cleanup when the response body is cancelled', async () => {
    const response = await GET(request());

    await response.body!.cancel();

    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('closes every active stream and cleans up each subscriber on server shutdown', async () => {
    const responses = await Promise.all([GET(request()), GET(request())]);
    const readers = responses.map((response) => response.body!.getReader());
    for (const reader of readers) expect((await reader.read()).done).toBe(false);

    mockShutdownController.abort(new Error('Server is shutting down'));

    for (const reader of readers) {
      await expect(reader.read()).resolves.toMatchObject({ done: true });
    }
    expect(mockCleanup).toHaveBeenCalledTimes(2);
  });

  it('closes cleanly when subscriber abort handling reports the shutdown reason first', async () => {
    mockSubscribe.mockImplementationOnce(
      async (
        _onMessage: unknown,
        options: { signal: AbortSignal; onLoss: (error: Error) => void }
      ) => {
        options.signal.addEventListener(
          'abort',
          () => options.onLoss(options.signal.reason as Error),
          { once: true }
        );
      }
    );
    const response = await GET(request());
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);

    mockShutdownController.abort(new Error('Server is shutting down'));

    await expect(reader.read()).resolves.toMatchObject({ done: true });
    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('keeps a distinct Redis loss observable when it races server shutdown', async () => {
    const failure = new Error('Redis subscriber connection ended');
    mockSubscribe.mockImplementationOnce(
      async (
        _onMessage: unknown,
        options: { signal: AbortSignal; onLoss: (error: Error) => void }
      ) => {
        options.signal.addEventListener('abort', () => options.onLoss(failure), { once: true });
      }
    );
    const response = await GET(request());
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);

    mockShutdownController.abort(new Error('Server is shutting down'));

    await expect(reader.read()).rejects.toBe(failure);
    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('cleans up a subscriber when shutdown interrupts admission', async () => {
    let admissionSignal!: AbortSignal;
    mockSubscribe.mockImplementationOnce(
      (_onMessage: unknown, options: { signal: AbortSignal }) => {
        admissionSignal = options.signal;
        return new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        });
      }
    );
    const pending = GET(request());
    await vi.waitFor(() => expect(admissionSignal).toBeDefined());
    const reason = new Error('Server is shutting down');
    mockShutdownController.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('rejects new streams after shutdown before opening a subscriber', async () => {
    const reason = new Error('Server is shutting down');
    mockShutdownController.abort(reason);

    await expect(GET(request())).rejects.toBe(reason);
    expect(mockAuthenticateRequest).not.toHaveBeenCalled();
    expect(mockCreateSubscriber).not.toHaveBeenCalled();
  });
});
