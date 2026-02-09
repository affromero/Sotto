import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockNotificationFindMany = vi.fn();
const mockNotificationCount = vi.fn();
const mockNotificationFindUnique = vi.fn();
const mockNotificationUpdate = vi.fn();
const mockNotificationUpdateMany = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: (...args: unknown[]) => mockNotificationFindMany(...args),
      count: (...args: unknown[]) => mockNotificationCount(...args),
      findUnique: (...args: unknown[]) => mockNotificationFindUnique(...args),
      update: (...args: unknown[]) => mockNotificationUpdate(...args),
      updateMany: (...args: unknown[]) => mockNotificationUpdateMany(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

import { GET } from '@/app/api/notifications/route';
import { PATCH } from '@/app/api/notifications/[notificationId]/route';
import { POST } from '@/app/api/notifications/mark-all-read/route';

const mockPrisma = {
  notification: {
    findMany: mockNotificationFindMany,
    count: mockNotificationCount,
    findUnique: mockNotificationFindUnique,
    update: mockNotificationUpdate,
    updateMany: mockNotificationUpdateMany,
  },
};

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/notifications');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const mockSession = {
  user: {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
  },
  expires: '2025-12-31T00:00:00Z',
};

const mockNotification1 = {
  id: 'notif-1',
  userId: 'user-1',
  type: 'PODCAST_READY',
  title: 'Podcast ready',
  message: 'Your podcast "Quantum Physics 101" is ready to listen',
  data: { podcastId: 'pod-1' },
  read: false,
  createdAt: new Date('2025-01-15T10:00:00Z'),
};

const mockNotification2 = {
  id: 'notif-2',
  userId: 'user-1',
  type: 'NEW_FOLLOWER',
  title: 'New follower',
  message: 'Bob started following you',
  data: { followerId: 'user-2' },
  read: true,
  createdAt: new Date('2025-01-14T10:00:00Z'),
};

const mockNotification3 = {
  id: 'notif-3',
  userId: 'user-1',
  type: 'PODCAST_LIKED',
  title: 'Podcast liked',
  message: 'Charlie liked your podcast "ML Basics"',
  data: { podcastId: 'pod-2', userId: 'user-3' },
  read: false,
  createdAt: new Date('2025-01-13T10:00:00Z'),
};

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns notifications with correct response shape', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([mockNotification1]);
    mockPrisma.notification.count
      .mockResolvedValueOnce(1) // total count
      .mockResolvedValueOnce(1); // unread count

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('notifications');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('unreadCount');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('hasMore');
    expect(Array.isArray(body.notifications)).toBe(true);
  });

  it('returns notification data with proper structure', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([mockNotification1]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    const notif = body.notifications[0];
    expect(notif.id).toBe('notif-1');
    expect(notif.type).toBe('PODCAST_READY');
    expect(notif.title).toBe('Podcast ready');
    expect(notif.message).toBe('Your podcast "Quantum Physics 101" is ready to listen');
    expect(notif.data).toEqual({ podcastId: 'pod-1' });
    expect(notif.read).toBe(false);
  });

  it('applies default parameters (page=1, limit=20)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('respects pagination with page and limit parameters', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([mockNotification2]);
    mockPrisma.notification.count.mockResolvedValue(25);

    const request = createRequest({ page: '2', limit: '10' });
    const response = await GET(request);
    const body = await response.json();

    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      })
    );
  });

  it('calculates hasMore correctly when more results exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([mockNotification1]);
    mockPrisma.notification.count.mockResolvedValue(25);

    const request = createRequest({ page: '1', limit: '10' });
    const response = await GET(request);
    const body = await response.json();

    expect(body.hasMore).toBe(true);
    expect(body.total).toBe(25);
  });

  it('calculates hasMore correctly when no more results', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([mockNotification1]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const request = createRequest({ page: '1', limit: '20' });
    const response = await GET(request);
    const body = await response.json();

    expect(body.hasMore).toBe(false);
  });

  it('filters notifications by userId', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const request = createRequest();
    await GET(request);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
      })
    );
  });

  it('returns empty list when user has no notifications', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notifications).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.unreadCount).toBe(0);
    expect(body.hasMore).toBe(false);
  });

  it('returns correct unreadCount when some notifications are unread', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([
      mockNotification1,
      mockNotification2,
      mockNotification3,
    ]);
    mockPrisma.notification.count
      .mockResolvedValueOnce(3) // total count
      .mockResolvedValueOnce(2); // unread count (notif-1 and notif-3)

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.total).toBe(3);
    expect(body.unreadCount).toBe(2);
  });

  it('orders notifications by createdAt desc (most recent first)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const request = createRequest();
    await GET(request);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('returns 400 for invalid page parameter (0)', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest({ page: '0' });
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid limit parameter (exceeds 50)', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest({ limit: '51' });
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('calculates skip correctly for page 3 with limit 5', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const request = createRequest({ page: '3', limit: '5' });
    await GET(request);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 5,
      })
    );
  });
});

describe('PATCH /api/notifications/[notificationId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const params = Promise.resolve({ notificationId: 'notif-1' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('marks notification as read and returns updated notification', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findUnique.mockResolvedValue(mockNotification1);
    mockPrisma.notification.update.mockResolvedValue({
      ...mockNotification1,
      read: true,
    });

    const request = createRequest();
    const params = Promise.resolve({ notificationId: 'notif-1' });
    const response = await PATCH(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('notif-1');
    expect(body.read).toBe(true);

    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notif-1' },
      data: { read: true },
    });
  });

  it('returns 404 when notification does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = Promise.resolve({ notificationId: 'nonexistent' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: 'Notification not found' });
  });

  it('returns 403 when user does not own the notification', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findUnique.mockResolvedValue({
      ...mockNotification1,
      userId: 'user-2', // different user
    });

    const request = createRequest();
    const params = Promise.resolve({ notificationId: 'notif-1' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'Forbidden' });

    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('checks notification ownership before updating', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.findUnique.mockResolvedValue(mockNotification1);
    mockPrisma.notification.update.mockResolvedValue({
      ...mockNotification1,
      read: true,
    });

    const request = createRequest();
    const params = Promise.resolve({ notificationId: 'notif-1' });
    await PATCH(request, { params });

    expect(mockPrisma.notification.findUnique).toHaveBeenCalledWith({
      where: { id: 'notif-1' },
    });
  });
});

describe('POST /api/notifications/mark-all-read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('marks all unread notifications as read and returns count', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

    const request = createRequest();
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, count: 5 });

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        read: false,
      },
      data: { read: true },
    });
  });

  it('returns count 0 when no unread notifications exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const request = createRequest();
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, count: 0 });
  });

  it('only marks current user notifications as read', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

    const request = createRequest();
    await POST(request);

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
        }),
      })
    );
  });

  it('only updates unread notifications (read: false)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 2 });

    const request = createRequest();
    await POST(request);

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          read: false,
        }),
      })
    );
  });
});
