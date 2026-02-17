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
      VAPID_SUBJECT: 'mailto:test@sotto.fm',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
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
      url: '/podcast/123',
      data: { podcastId: '123' },
    });

    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      'mailto:test@sotto.fm',
      'test-public-key',
      'test-private-key'
    );

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: 'Test Notification',
      body: 'This is a test',
      url: '/podcast/123',
    });

    expect(logger.info).toHaveBeenCalledWith('Push notifications sent', expect.any(Object));
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
      where: { id: { in: ['sub2'] } },
    });

    expect(logger.info).toHaveBeenCalledWith('Cleaned up expired push subscriptions', expect.any(Object));

    expect(logger.info).toHaveBeenCalledWith('Push notifications sent', expect.any(Object));
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
      title: 'Podcast Ready',
      body: 'Your podcast is ready to listen',
      url: '/podcast/abc',
      data: { podcastId: 'abc', action: 'view' },
    });

    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: 'Podcast Ready',
      body: 'Your podcast is ready to listen',
      url: '/podcast/abc',
      data: { podcastId: 'abc', action: 'view' },
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
      expect.stringContaining('"url":"/"')
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

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(logger.info).toHaveBeenCalledWith('Push notifications sent', expect.any(Object));
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
      where: { id: { in: ['sub1'] } },
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
      'VAPID keys not configured — push notifications disabled'
    );
  });

  it('logs debug message when user has no subscriptions', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@sotto.fm';

    const { sendPushNotification } = await import('@/lib/push-notifications');

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue([]);

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(logger.debug).toHaveBeenCalledWith('No push subscriptions for user', {
      userId: 'user1',
    });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('handles partial success with mixed results', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@sotto.fm';

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
      .mockResolvedValueOnce(undefined);

    await sendPushNotification({
      userId: 'user1',
      title: 'Test',
      body: 'Test',
    });

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub2'] } },
    });

    expect(logger.info).toHaveBeenCalledWith('Push notifications sent', expect.any(Object));
  });

  it('uses default VAPID subject when not configured', async () => {
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

    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      'mailto:hello@sotto.fm',
      expect.any(String),
      expect.any(String)
    );
  });
});
