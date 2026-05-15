import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNotification,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

describe('createNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates notification with all parameters', async () => {
    const mockNotification = {
      id: 'notif1',
      userId: 'user1',
      type: 'PODCAST_READY',
      title: 'Your podcast is ready',
      message: 'Your podcast "Test" is ready to listen',
      data: { podcastId: 'pod1' },
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.notification.create).mockResolvedValue(mockNotification as any);

    const result = await createNotification(
      'user1',
      'PODCAST_READY',
      'Your podcast is ready',
      'Your podcast "Test" is ready to listen',
      { podcastId: 'pod1' }
    );

    expect(result).toEqual(mockNotification);
  });
});

describe('getUserNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches notifications ordered by most recent first', async () => {
    const mockNotifications = [
      {
        id: 'notif2',
        userId: 'user1',
        type: 'BRIEFING_READY',
        title: 'Briefing ready',
        message: 'Your daily briefing is ready',
        data: null,
        read: false,
        createdAt: new Date('2026-02-09T12:00:00Z'),
        updatedAt: new Date('2026-02-09T12:00:00Z'),
      },
      {
        id: 'notif1',
        userId: 'user1',
        type: 'PODCAST_READY',
        title: 'Podcast ready',
        message: 'Your podcast is ready',
        data: null,
        read: true,
        createdAt: new Date('2026-02-08T12:00:00Z'),
        updatedAt: new Date('2026-02-08T12:00:00Z'),
      },
    ];

    vi.mocked(prisma.notification.findMany).mockResolvedValue(mockNotifications as any);

    const result = await getUserNotifications('user1');

    expect(result).toEqual(mockNotifications);
  });
});

describe('markNotificationRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks single notification as read', async () => {
    const mockNotification = {
      id: 'notif1',
      userId: 'user1',
      type: 'PODCAST_READY',
      title: 'Test',
      message: 'Test',
      data: null,
      read: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.notification.update).mockResolvedValue(mockNotification as any);

    const result = await markNotificationRead('notif1');

    expect(result).toEqual(mockNotification);
  });
});

describe('markAllNotificationsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks all unread notifications as read for user', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 5 });

    const result = await markAllNotificationsRead('user1');

    expect(result).toEqual({ count: 5 });
  });

  it('returns zero count when no unread notifications exist', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 0 });

    const result = await markAllNotificationsRead('user1');

    expect(result).toEqual({ count: 0 });
  });
});

describe('getUnreadCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns count of unread notifications for user', async () => {
    vi.mocked(prisma.notification.count).mockResolvedValue(3);

    const count = await getUnreadCount('user1');

    expect(count).toBe(3);
  });

  it('returns zero when user has no unread notifications', async () => {
    vi.mocked(prisma.notification.count).mockResolvedValue(0);

    const count = await getUnreadCount('user1');

    expect(count).toBe(0);
  });
});
