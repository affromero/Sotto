import { Job } from 'bullmq';
import type { NotificationType } from '@prisma/client';
import { SendNotificationPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sendPushNotification, sendExpoPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

export async function processNotification(job: Job<SendNotificationPayload>): Promise<void> {
  const { userId, type, title, message, data } = job.data;

  logger.info('Sending notification', { userId, type });

  // Create in-app notification
  await prisma.notification.create({
    data: {
      userId,
      type: type as NotificationType,
      title,
      message,
      data: data || undefined,
    },
  });

  // Send push notifications (web + mobile) in parallel
  await Promise.all([
    sendPushNotification({ userId, title, body: message, data }),
    sendExpoPushNotification({ userId, title, body: message, data }),
  ]);

  logger.info('Notification sent', { userId, type });
}
