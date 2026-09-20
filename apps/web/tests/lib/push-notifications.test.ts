import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    pushSubscription: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockSetVapidDetails = vi.fn();
const mockSendNotification = vi.fn();

vi.mock('web-push', async () => {
  return {
    default: {
      setVapidDetails: mockSetVapidDetails,
      sendNotification: mockSendNotification,
    },
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
  };
});

describe('push-notifications', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'test-public-key',
      VAPID_PRIVATE_KEY: 'test-private-key',
      VAPID_SUBJECT: 'mailto:test@example.com',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('sends a captured device with its stable notification identity and request credentials', async () => {
    const { sendPushToSubscription, pushSubscriptionVersion } =
      await import('@/lib/push-notifications');
    const device = {
      id: 'device',
      userId: 'learner',
      endpoint: 'https://push.example.com/device',
      p256dh: 'device-key',
      auth: 'device-auth',
    };
    mockSendNotification.mockResolvedValue(undefined);
    await expect(
      sendPushToSubscription(device, {
        title: 'Ready',
        body: 'Your episode is ready',
        notificationId: 'notification-1',
      })
    ).resolves.toBe('delivered');
    expect(mockSendNotification.mock.calls[0]?.[0]).toEqual({
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth },
    });
    expect(JSON.parse(mockSendNotification.mock.calls[0]?.[1])).toMatchObject({
      notificationId: 'notification-1',
      title: 'Ready',
    });
    expect(mockSendNotification.mock.calls[0]?.[2]).toEqual({
      timeout: 15_000,
      vapidDetails: {
        subject: 'mailto:test@example.com',
        publicKey: 'test-public-key',
        privateKey: 'test-private-key',
      },
    });
    expect(pushSubscriptionVersion({ ...device })).toBe(pushSubscriptionVersion(device));
    expect(pushSubscriptionVersion({ ...device, auth: 'replacement' })).not.toBe(
      pushSubscriptionVersion(device)
    );
  });

  it('preserves a failed single-device delivery for the caller to retry', async () => {
    const { sendPushToSubscription } = await import('@/lib/push-notifications');
    const failure = { statusCode: 503 };
    mockSendNotification.mockRejectedValue(failure);
    await expect(
      sendPushToSubscription(
        {
          id: 'device',
          userId: 'learner',
          endpoint: 'https://push.example.com/device',
          p256dh: 'device-key',
          auth: 'device-auth',
        },
        { title: 'Ready', body: 'Ready' }
      )
    ).rejects.toBe(failure);
  });

  it('sends push notification to all user subscriptions', async () => {
    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'https://push.example.com/1',
        p256dh: 'p256dh-key-1',
        auth: 'auth-key-1',
        createdAt: new Date(),
      },
      {
        id: 'sub2',
        userId: 'user1',
        endpoint: 'https://push.example.com/2',
        p256dh: 'p256dh-key-2',
        auth: 'auth-key-2',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    mockSendNotification.mockResolvedValue(undefined);

    await sendPushNotification({
      userId: 'user1',
      title: 'Test Notification',
      body: 'This is a test',
      url: '/episode/123',
      data: { episodeId: '123' },
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: 'Test Notification',
      body: 'This is a test',
      url: '/episode/123',
    });
  });

  it('cleans up expired subscriptions with 410 status', async () => {
    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'https://push.example.com/1',
        p256dh: 'p256dh-key-1',
        auth: 'auth-key-1',
        createdAt: new Date(),
      },
      {
        id: 'sub2',
        userId: 'user1',
        endpoint: 'https://push.example.com/2',
        p256dh: 'p256dh-key-2',
        auth: 'auth-key-2',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValue({ count: 1 });

    mockSendNotification
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ statusCode: 410 });

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          expect.objectContaining({
            id: 'sub2',
            userId: 'user1',
            endpoint: mockSubscriptions[1]!.endpoint,
            p256dh: mockSubscriptions[1]!.p256dh,
            auth: mockSubscriptions[1]!.auth,
          }),
        ],
      },
    });
  });

  it('formats payload with title, body, url, and data', async () => {
    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'https://push.example.com/1',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    mockSendNotification.mockResolvedValue(undefined);

    await sendPushNotification({
      userId: 'user1',
      title: 'Episode Ready',
      body: 'Your episode is ready to listen',
      url: '/episode/abc',
      data: { episodeId: 'abc', action: 'view' },
    });

    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: 'Episode Ready',
      body: 'Your episode is ready to listen',
      url: '/episode/abc',
      data: { episodeId: 'abc', action: 'view' },
    });
  });

  it('defaults url to root path when not provided', async () => {
    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'https://push.example.com/1',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    mockSendNotification.mockResolvedValue(undefined);

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('"url":"/"'),
      expect.any(Object)
    );
  });

  it('handles invalid push endpoint gracefully', async () => {
    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'invalid-endpoint',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    mockSendNotification.mockRejectedValue(new Error('Invalid endpoint'));

    await expect(
      sendPushNotification({
        userId: 'user1',
        title: 'Test',
        body: 'Test',
      })
    ).resolves.toMatchObject({
      status: 'attempted',
      sent: 0,
      failed: 1,
      expired: 0,
      deliveries: [
        expect.objectContaining({
          subscriptionId: 'sub1',
          status: 'retry',
          version: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
    });
  });

  it('handles subscription gone error (410) during send', async () => {
    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'https://push.example.com/1',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValue({ count: 1 });
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          expect.objectContaining({
            id: 'sub1',
            userId: 'user1',
            endpoint: mockSubscriptions[0]!.endpoint,
            p256dh: mockSubscriptions[0]!.p256dh,
            auth: mockSubscriptions[0]!.auth,
          }),
        ],
      },
    });
  });

  it('does nothing when VAPID keys are not configured', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = '';
    process.env.VAPID_PRIVATE_KEY = '';

    const { sendPushNotification } = await import('@/lib/push-notifications');

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      'VAPID keys and subject not configured — push notifications disabled'
    );
  });

  it('does not send notifications when user has no subscriptions', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';

    const { sendPushNotification } = await import('@/lib/push-notifications');

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue([]);

    await expect(
      sendPushNotification({
        userId: 'user1',
        title: 'Test',
        body: 'Test',
      })
    ).resolves.toEqual({
      status: 'no-subscriptions',
      sent: 0,
      failed: 0,
      expired: 0,
      deliveries: [],
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('handles partial success with mixed results', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';

    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'https://push.example.com/1',
        p256dh: 'key1',
        auth: 'auth1',
        createdAt: new Date(),
      },
      {
        id: 'sub2',
        userId: 'user1',
        endpoint: 'https://push.example.com/2',
        p256dh: 'key2',
        auth: 'auth2',
        createdAt: new Date(),
      },
      {
        id: 'sub3',
        userId: 'user1',
        endpoint: 'https://push.example.com/3',
        p256dh: 'key3',
        auth: 'auth3',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValue({ count: 1 });

    mockSendNotification
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 503 });

    const result = await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(result).toMatchObject({ status: 'attempted', sent: 1, expired: 1, failed: 1 });
    expect(
      result.deliveries.map(({ subscriptionId, status }) => ({ subscriptionId, status }))
    ).toEqual([
      { subscriptionId: 'sub1', status: 'delivered' },
      { subscriptionId: 'sub2', status: 'expired' },
      { subscriptionId: 'sub3', status: 'retry' },
    ]);

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          expect.objectContaining({
            id: 'sub2',
            userId: 'user1',
            endpoint: mockSubscriptions[1]!.endpoint,
            p256dh: mockSubscriptions[1]!.p256dh,
            auth: mockSubscriptions[1]!.auth,
          }),
        ],
      },
    });
  });

  it('does not send when VAPID subject is not configured', async () => {
    vi.resetModules();
    delete process.env.VAPID_SUBJECT;
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';

    const { sendPushNotification } = await import('@/lib/push-notifications');

    const mockSubscriptions = [
      {
        id: 'sub1',
        userId: 'user1',
        endpoint: 'https://push.example.com/1',
        p256dh: 'key',
        auth: 'auth',
        createdAt: new Date(),
      },
    ];

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubscriptions);
    mockSendNotification.mockResolvedValue(undefined);

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      'VAPID keys and subject not configured — push notifications disabled'
    );
    expect(mockSetVapidDetails).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
