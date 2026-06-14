import { Job } from 'bullmq';
import type { NotificationType } from '@/generated/prisma/client';
import { SendNotificationPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sendPushNotification } from '@/lib/push-notifications';
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

  // Send web push notifications only if the user has opted in.
  if (user?.pushNotifications) {
    const pushResults = await Promise.allSettled([
      sendPushNotification({ userId, title, body: message, data }),
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
