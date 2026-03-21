import { Job } from 'bullmq';
import type { NotificationType } from '@prisma/client';
import { SendNotificationPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sendPushNotification, sendExpoPushNotification } from '@/lib/push-notifications';
import { publishNotification } from '@/lib/redis';
import { logger } from '@/lib/logger';

export async function processNotification(job: Job<SendNotificationPayload>): Promise<void> {
  const { userId, type, title, message, data } = job.data;

  logger.info('Sending notification', { userId, type });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pushNotifications: true },
  });

  // Create in-app notification
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: type as NotificationType,
      title,
      message,
      data: data || undefined,
    },
  });

  // Publish to Redis so SSE subscribers receive it instantly
  publishNotification(userId, {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data,
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
  }).catch((err) => {
    logger.warn('Failed to publish notification to Redis', {
      userId,
      type,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Send push notifications (web + mobile) only if user has opted in
  // Use allSettled so a failure in one channel doesn't abort the other or retry the in-app notification
  if (user?.pushNotifications) {
    const pushResults = await Promise.allSettled([
      sendPushNotification({ userId, title, body: message, data }),
      sendExpoPushNotification({ userId, title, body: message, data }),
    ]);

    const anyPushSucceeded = pushResults.some((r) => r.status === 'fulfilled');
    if (anyPushSucceeded) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { pushed: true },
      });
    }

    for (const result of pushResults) {
      if (result.status === 'rejected') {
        logger.warn('Push notification channel failed', {
          userId,
          type,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  logger.info('Notification sent', { userId, type });
}
