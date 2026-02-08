import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaNotificationCreate = vi.fn().mockResolvedValue({ id: 'notif-001' });

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      create: (...args: unknown[]) => mockPrismaNotificationCreate(...args),
    },
  },
}));

const mockSendPushNotification = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/push-notifications', () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPushNotification(...args),
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
    mockPrismaNotificationCreate.mockResolvedValue({ id: 'notif-001' });
    mockSendPushNotification.mockResolvedValue(undefined);
  });

  describe('in-app notification creation', () => {
    it('creates a notification record in the database', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledTimes(1);
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

    it('creates the notification with PODCAST_READY type', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'PODCAST_READY' }),
        })
      );
    });

    it('creates the notification with PODCAST_LIKED type', async () => {
      const job = createMockJob({
        ...defaultPayload,
        type: 'PODCAST_LIKED',
        title: 'Someone liked your podcast',
        message: 'John liked your podcast.',
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'PODCAST_LIKED' }),
        })
      );
    });

    it('creates the notification with PODCAST_FORKED type', async () => {
      const job = createMockJob({
        ...defaultPayload,
        type: 'PODCAST_FORKED',
        title: 'Your podcast was forked',
        message: 'Jane forked your podcast.',
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'PODCAST_FORKED' }),
        })
      );
    });

    it('creates the notification with NEW_FOLLOWER type', async () => {
      const job = createMockJob({
        ...defaultPayload,
        type: 'NEW_FOLLOWER',
        title: 'New follower!',
        message: 'You have a new follower.',
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'NEW_FOLLOWER' }),
        })
      );
    });

    it('creates the notification with SIMILAR_PODCAST_CREATED type', async () => {
      const job = createMockJob({
        ...defaultPayload,
        type: 'SIMILAR_PODCAST_CREATED',
        title: 'Similar podcast created',
        message: 'A similar podcast was created on a topic you follow.',
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'SIMILAR_PODCAST_CREATED' }),
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

  describe('push notification delivery', () => {
    it('sends a push notification to the user', async () => {
      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(mockSendPushNotification).toHaveBeenCalledTimes(1);
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
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        message: 'You have a new follower.',
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
      expect(mockSendPushNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('ordering of operations', () => {
    it('creates the in-app notification before sending push', async () => {
      const callOrder: string[] = [];
      mockPrismaNotificationCreate.mockImplementation(async () => {
        callOrder.push('create');
        return { id: 'notif-order-test' };
      });
      mockSendPushNotification.mockImplementation(async () => {
        callOrder.push('push');
      });

      const job = createMockJob(defaultPayload);
      await processNotification(job);

      expect(callOrder).toEqual(['create', 'push']);
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

    it('correctly processes a NEW_FOLLOWER notification without data', async () => {
      const job = createMockJob({
        userId: 'user-followed',
        type: 'NEW_FOLLOWER',
        title: 'New follower!',
        message: 'Alice started following you.',
      });
      await processNotification(job);

      expect(mockPrismaNotificationCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-followed',
          type: 'NEW_FOLLOWER',
          title: 'New follower!',
          message: 'Alice started following you.',
          data: undefined,
        },
      });

      expect(mockSendPushNotification).toHaveBeenCalledWith({
        userId: 'user-followed',
        title: 'New follower!',
        body: 'Alice started following you.',
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

    it('propagates errors from push notification sending', async () => {
      mockSendPushNotification.mockRejectedValue(new Error('Push service unavailable'));
      const job = createMockJob(defaultPayload);

      await expect(processNotification(job)).rejects.toThrow('Push service unavailable');
    });

    it('does not send push notification if in-app creation fails', async () => {
      mockPrismaNotificationCreate.mockRejectedValue(new Error('DB error'));
      const job = createMockJob(defaultPayload);

      await expect(processNotification(job)).rejects.toThrow('DB error');
      expect(mockSendPushNotification).not.toHaveBeenCalled();
    });
  });
});
