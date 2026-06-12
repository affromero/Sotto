import { prisma } from './prisma';
import { NotificationType } from '@/generated/prisma/client';

/**
 * Create a new in-app notification for a user.
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  data?: Record<string, string>
) {
  return prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      data: data ?? undefined,
    },
  });
}

/**
 * Fetch notifications for a user, ordered by most recent first.
 */
export async function getUserNotifications(
  userId: string,
  limit: number = 50,
  offset: number = 0
) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(notificationId: string) {
  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllNotificationsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

/**
 * Get the count of unread notifications for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}
