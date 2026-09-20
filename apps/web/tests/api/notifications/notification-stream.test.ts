import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockSubscribe = vi.fn();
const mockCleanup = vi.fn();
const mockCreateSubscriber = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));
vi.mock('@/lib/redis', () => ({
  createNotificationSubscriber: (...args: unknown[]) => mockCreateSubscriber(...args),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { GET } from '@/app/api/v1/notifications/stream/route';

function request(signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/v1/notifications/stream', { signal });
}

describe('GET notification stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
