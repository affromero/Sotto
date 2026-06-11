import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockPushSubscriptionUpsert = vi.fn();
const mockPushSubscriptionDeleteMany = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    pushSubscription: {
      upsert: (...args: unknown[]) => mockPushSubscriptionUpsert(...args),
      deleteMany: (...args: unknown[]) => mockPushSubscriptionDeleteMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { POST, DELETE } from '@/app/api/v1/notifications/subscribe/route';

function createRequest(method: string, body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/notifications/subscribe'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbBzGGGFyA',
    auth: 'tBHItJI5svbpC7F8',
  },
};

describe('POST /api/v1/notifications/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushSubscriptionUpsert.mockResolvedValue({ id: 'sub-1' });
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createRequest('POST', validSubscription);
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 when endpoint is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('POST', { keys: validSubscription.keys });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid subscription data' });
  });

  it('returns 400 when endpoint is not a valid URL', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('POST', { endpoint: 'not-a-url', keys: validSubscription.keys });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid subscription data' });
  });

  it('returns 400 when keys are missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('POST', { endpoint: validSubscription.endpoint });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid subscription data' });
  });

  it('returns 400 when p256dh key is empty', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('POST', {
      endpoint: validSubscription.endpoint,
      keys: { p256dh: '', auth: 'valid' },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid subscription data' });
  });

  it('upserts push subscription and returns subscribed: true', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('POST', validSubscription);
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ subscribed: true });
    expect(mockPushSubscriptionUpsert).toHaveBeenCalledWith({
      where: { endpoint: validSubscription.endpoint },
      create: {
        userId: 'user-1',
        endpoint: validSubscription.endpoint,
        p256dh: validSubscription.keys.p256dh,
        auth: validSubscription.keys.auth,
      },
      update: {
        userId: 'user-1',
        p256dh: validSubscription.keys.p256dh,
        auth: validSubscription.keys.auth,
      },
    });
  });
});

describe('DELETE /api/v1/notifications/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushSubscriptionDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createRequest('DELETE', { endpoint: validSubscription.endpoint });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 when endpoint is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('DELETE', {});
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid request' });
  });

  it('returns 400 when endpoint is not a valid URL', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('DELETE', { endpoint: 'not-a-url' });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid request' });
  });

  it('deletes subscription scoped to user and returns subscribed: false', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('DELETE', { endpoint: validSubscription.endpoint });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ subscribed: false });
    expect(mockPushSubscriptionDeleteMany).toHaveBeenCalledWith({
      where: {
        endpoint: validSubscription.endpoint,
        userId: 'user-1',
      },
    });
  });

  it('returns subscribed: false even when no subscription existed', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPushSubscriptionDeleteMany.mockResolvedValue({ count: 0 });

    const request = createRequest('DELETE', { endpoint: validSubscription.endpoint });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ subscribed: false });
  });
});
