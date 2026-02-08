import { Job } from 'bullmq';
import { SendNotificationPayload } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

export async function processNotification(job: Job<SendNotificationPayload>): Promise<void> {
  const { userId, type, title, message, data } = job.data;

  logger.info('Sending notification', { userId, type });

  // Create in-app notification
  await prisma.notification.create({
    data: {
      userId,
      type: type as 'PODCAST_READY' | 'PODCAST_LIKED' | 'PODCAST_FORKED' | 'NEW_FOLLOWER' | 'SIMILAR_PODCAST_CREATED',
      title,
      message,
      data: data || undefined,
    },
  });

  // Send push notification
  await sendPushNotification({ userId, title, body: message, data });

  logger.info('Notification sent', { userId, type });
}
