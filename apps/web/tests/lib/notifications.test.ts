import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNotification,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() { return this.prisma; },
  prisma: {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

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
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user1',
        type: 'PODCAST_READY',
        title: 'Your podcast is ready',
        message: 'Your podcast "Test" is ready to listen',
        data: { podcastId: 'pod1' },
      },
    });
  });

  it('creates notification without data parameter', async () => {
    const mockNotification = {
      id: 'notif2',
      userId: 'user2',
      type: 'NEW_FOLLOWER',
      title: 'New follower',
      message: 'Alice started following you',
      data: null,
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.notification.create).mockResolvedValue(mockNotification as any);

    const result = await createNotification(
      'user2',
      'NEW_FOLLOWER',
      'New follower',
      'Alice started following you'
    );

    expect(result).toEqual(mockNotification);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user2',
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        message: 'Alice started following you',
        data: undefined,
      },
    });
  });

  it.each([
    ['PODCAST_READY', 'Podcast Ready', 'Your podcast is ready'],
    ['NEW_FOLLOWER', 'New Follower', 'Someone followed you'],
    ['INTERACTION_RESOLVED', 'Question Answered', 'Your question was answered'],
    ['PODCAST_LIKED', 'Podcast Liked', 'Someone liked your podcast'],
  ] as const)('creates %s notification type', async (type, title, message) => {
    const mockNotification = {
      id: `notif-${type}`,
      userId: 'user1',
      type,
      title,
      message,
      data: null,
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.notification.create).mockResolvedValue(mockNotification as any);

    const result = await createNotification('user1', type as any, title, message);

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
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        message: 'Alice followed you',
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
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('respects custom limit parameter', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);

    await getUserNotifications('user1', 10);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      })
    );
  });

  it('respects offset parameter for pagination', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);

    await getUserNotifications('user1', 20, 40);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        skip: 40,
      })
    );
  });

  it('defaults to limit of 50 when not provided', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);

    await getUserNotifications('user1');

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );
  });

  it('filters notifications by user ID', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);

    await getUserNotifications('user123');

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user123' },
      })
    );
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
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notif1' },
      data: { read: true },
    });
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
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user1', read: false },
      data: { read: true },
    });
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
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'user1', read: false },
    });
  });

  it('returns zero when user has no unread notifications', async () => {
    vi.mocked(prisma.notification.count).mockResolvedValue(0);

    const count = await getUnreadCount('user1');

    expect(count).toBe(0);
  });

  it('counts only unread notifications', async () => {
    vi.mocked(prisma.notification.count).mockResolvedValue(7);

    await getUnreadCount('user1');

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'user1', read: false },
    });
  });
});
