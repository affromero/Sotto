import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaNotificationCreate = vi.fn().mockResolvedValue({ id: 'notif-001' });
const mockPrismaNotificationUpdate = vi.fn().mockResolvedValue({ id: 'notif-001', pushed: true });
const mockPrismaUserFindUnique = vi.fn().mockResolvedValue({ pushNotifications: true });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    notification: {
      create: (...args: unknown[]) => mockPrismaNotificationCreate(...args),
      update: (...args: unknown[]) => mockPrismaNotificationUpdate(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockSendPushNotification = vi.fn().mockResolvedValue(undefined);
const mockSendExpoPushNotification = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/push-notifications', () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPushNotification(...args),
  sendExpoPushNotification: (...args: unknown[]) => mockSendExpoPushNotification(...args),
}));

const mockPublishNotification = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/redis', () => ({
  publishNotification: (...args: unknown[]) => mockPublishNotification(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import { processNotification } from '@/workers/notification.worker';
import type { SendNotificationPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: SendNotificationPayload): Job<SendNotificationPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<SendNotificationPayload>;
}

const defaultPayload: SendNotificationPayload = {
  userId: 'user-001',
  type: 'PODCAST_READY',
  title: 'Your podcast is ready!',
  message: 'Your podcast "Quantum Physics 101" is ready to listen.',
};

// ---- Tests ----

describe('processNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaNotificationCreate.mockResolvedValue({
      id: 'notif-001',
      type: 'PODCAST_READY',
      title: 'Your podcast is ready!',
      message: 'Ready.',
      data: null,
      read: false,
      createdAt: new Date('2026-03-22T00:00:00Z'),
    });
    mockPrismaUserFindUnique.mockResolvedValue({ pushNotifications: true });
    mockSendPushNotification.mockResolvedValue(undefined);
    mockSendExpoPushNotification.mockResolvedValue(undefined);
    mockPublishNotification.mockResolvedValue(undefined);
  });

  describe('in-app notification creation', () => {
    it('creates a notification record in the database', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalled();
    });

    it('creates the notification with correct userId', async () => {
      const job = createMockJob({ ...defaultPayload, userId: 'user-xyz' });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-xyz' }),
        })
      );
    });

    it.each([
      { type: 'PODCAST_READY', title: 'Your podcast is ready!', message: 'Ready.' },
      { type: 'BRIEFING_READY', title: 'Briefing ready!', message: 'Ready.' },
      { type: 'SIMILAR_PODCAST_CREATED', title: 'Similar podcast created', message: 'Similar.' },
      { type: 'QUESTION_ON_YOUR_PODCAST', title: 'New question', message: 'Asked.' },
    ] as const)('creates notification with $type type', async ({ type, title, message }) => {
      const job = createMockJob({ ...defaultPayload, type, title, message });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type }),
        })
      );
    });

    it('creates the notification with correct title', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Your podcast is ready!' }),
        })
      );
    });

    it('creates the notification with correct message', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: 'Your podcast "Quantum Physics 101" is ready to listen.',
          }),
        })
      );
    });

    it('stores extra data when provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        data: { podcastId: 'pod-123', url: '/podcast/pod-123' },
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: { podcastId: 'pod-123', url: '/podcast/pod-123' },
          }),
        })
      );
    });

    it('passes undefined for data when not provided', async () => {
      const payload: SendNotificationPayload = {
        userId: 'user-001',
        type: 'PODCAST_READY',
        title: 'Ready',
        message: 'Your podcast is ready.',
      };
      const job = createMockJob(payload);
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: undefined,
          }),
        })
      );
    });
  });

  describe('SSE publish via Redis', () => {
    it('publishes notification to Redis after DB creation', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPublishNotification).toHaveBeenCalledWith(
        'user-001',
        expect.objectContaining({
          id: 'notif-001',
          type: 'PODCAST_READY',
          title: 'Your podcast is ready!',
        })
      );
    });

    it('does not fail if Redis publish fails', async () => {
      mockPublishNotification.mockRejectedValue(new Error('Redis down'));
      const job = createMockJob(defaultPayload);

      await expect(processNotification(job)).resolves.toBeUndefined();
    });
  });

  describe('push notification delivery', () => {
    it('sends push notifications when user has pushNotifications enabled', async () => {
      mockPrismaUserFindUnique.mockResolvedValue({ pushNotifications: true });
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockSendPushNotification).toHaveBeenCalled();
      expect(mockSendExpoPushNotification).toHaveBeenCalled();
    });

    it('marks notification as pushed when push delivery succeeds', async () => {
      mockPrismaUserFindUnique.mockResolvedValue({ pushNotifications: true });
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationUpdate).toHaveBeenCalledWith({
        where: { id: 'notif-001' },
        data: { pushed: true },
      });
    });

    it('does not mark pushed when push notifications are disabled', async () => {
      mockPrismaUserFindUnique.mockResolvedValue({ pushNotifications: false });
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationUpdate).not.toHaveBeenCalled();
    });

    it('skips push notifications when user has pushNotifications disabled', async () => {
      mockPrismaUserFindUnique.mockResolvedValue({ pushNotifications: false });
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockSendPushNotification).not.toHaveBeenCalled();
      expect(mockSendExpoPushNotification).not.toHaveBeenCalled();
    });

    it('still creates in-app notification even when pushNotifications is disabled', async () => {
      mockPrismaUserFindUnique.mockResolvedValue({ pushNotifications: false });
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalled();
    });

    it('sends push notification with correct userId', async () => {
      const job = createMockJob({ ...defaultPayload, userId: 'user-push-test' });
      await processNotification(job);

      expect(mockSendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-push-test' })
      );
    });

    it('sends push notification with correct title', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockSendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Your podcast is ready!' })
      );
    });

    it('sends push notification with message as body', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockSendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Your podcast "Quantum Physics 101" is ready to listen.',
        })
      );
    });

    it('includes data in push notification when provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        data: { podcastId: 'pod-456' },
      });
      await processNotification(job);

      expect(mockSendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { podcastId: 'pod-456' },
        })
      );
    });

    it('sends push notification without data when not provided', async () => {
      const payload: SendNotificationPayload = {
        userId: 'user-001',
        type: 'BRIEFING_READY',
        title: 'Briefing ready',
        message: 'Your daily briefing is ready.',
      };
      const job = createMockJob(payload);
      await processNotification(job);

      expect(mockSendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          data: undefined,
        })
      );
    });

    it('does not fail when sendPushNotification handles users with no subscriptions', async () => {
      // sendPushNotification internally handles no subscriptions gracefully
      // (returns early with a debug log). The notification worker simply calls it.
      mockSendPushNotification.mockResolvedValue(undefined);
      const job = createMockJob(defaultPayload);

      await expect(processNotification(job)).resolves.toBeUndefined();
    });
  });

  describe('complete notification payloads', () => {
    it('correctly processes a full PODCAST_READY notification', async () => {
      const job = createMockJob({
        userId: 'user-abc',
        type: 'PODCAST_READY',
        title: 'Your podcast is ready!',
        message: 'Listen to "AI in Healthcare" now.',
        data: { podcastId: 'pod-health', url: '/podcast/pod-health' },
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-abc',
          type: 'PODCAST_READY',
          title: 'Your podcast is ready!',
          message: 'Listen to "AI in Healthcare" now.',
          data: { podcastId: 'pod-health', url: '/podcast/pod-health' },
        },
      });

      expect(mockSendPushNotification).toHaveBeenCalledWith({
        userId: 'user-abc',
        title: 'Your podcast is ready!',
        body: 'Listen to "AI in Healthcare" now.',
        data: { podcastId: 'pod-health', url: '/podcast/pod-health' },
      });
    });

    it('correctly processes a BRIEFING_READY notification without data', async () => {
      const job = createMockJob({
        userId: 'user-briefing',
        type: 'BRIEFING_READY',
        title: 'Briefing ready!',
        message: 'Your daily briefing is ready.',
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-briefing',
          type: 'BRIEFING_READY',
          title: 'Briefing ready!',
          message: 'Your daily briefing is ready.',
          data: undefined,
        },
      });

      expect(mockSendPushNotification).toHaveBeenCalledWith({
        userId: 'user-briefing',
        title: 'Briefing ready!',
        body: 'Your daily briefing is ready.',
        data: undefined,
      });
    });
  });

  describe('error propagation', () => {
    it('propagates errors from notification creation', async () => {
      mockPrismaNotificationCreate.mockRejectedValue(new Error('Database connection lost'));
      const job = createMockJob(defaultPayload);

      await expect(processNotification(job)).rejects.toThrow('Database connection lost');
    });

    it('logs push notification failure without rethrowing (in-app already created)', async () => {
      const { logger } = await import('@/lib/logger');
      mockSendPushNotification.mockRejectedValue(new Error('Push service unavailable'));
      const job = createMockJob(defaultPayload);

      // Should not throw — push failure is logged, job succeeds
      await expect(processNotification(job)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Push notification channel failed'),
        expect.objectContaining({ error: 'Push service unavailable' })
      );
    });

    it('does not send push notification if in-app creation fails', async () => {
      mockPrismaNotificationCreate.mockRejectedValue(new Error('DB error'));
      const job = createMockJob(defaultPayload);

      await expect(processNotification(job)).rejects.toThrow('DB error');
      expect(mockSendPushNotification).not.toHaveBeenCalled();
    });
  });
});
