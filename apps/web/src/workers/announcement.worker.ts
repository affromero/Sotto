import { Job } from 'bullmq';
import type { NotificationType } from '@prisma/client';
import { AnnouncementPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sendPushNotification, sendExpoPushNotification } from '@/lib/push-notifications';
import { sendEmail } from '@/lib/email';
import { buildAnnouncementEmail, generateUserUnsubscribeUrl } from '@/lib/email-templates';
import { logger } from '@/lib/logger';

const BATCH_SIZE = 100;

export async function processAnnouncement(job: Job<AnnouncementPayload>): Promise<void> {
  const { subject, message } = job.data;

  logger.info('Starting platform announcement fan-out', { subject });

  const total = await prisma.user.count();
  let processed = 0;
  let cursor: string | undefined;

  while (true) {
    const users = await prisma.user.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        email: true,
        pushNotifications: true,
        emailNotifications: true,
      },
      orderBy: { id: 'asc' },
    });

    if (users.length === 0) break;

    for (const user of users) {
      try {
        await prisma.notification.create({
          data: {
            userId: user.id,
            type: 'PLATFORM_ANNOUNCEMENT' as NotificationType,
            title: subject,
            message,
          },
        });

        if (user.pushNotifications) {
          await Promise.all([
            sendPushNotification({ userId: user.id, title: subject, body: message }),
            sendExpoPushNotification({ userId: user.id, title: subject, body: message }),
          ]);
        }

        if (user.emailNotifications && user.email) {
          const unsubscribeUrl = generateUserUnsubscribeUrl(user.id);
          const { subject: emailSubject, html } = buildAnnouncementEmail(
            subject,
            message,
            unsubscribeUrl
          );
          await sendEmail({ to: user.email, subject: emailSubject, html });
        }
      } catch (err) {
        logger.error('Failed to send announcement to user', {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    processed += users.length;
    await job.updateProgress(total > 0 ? Math.floor((processed / total) * 100) : 100);

    cursor = users[users.length - 1].id;
    if (users.length < BATCH_SIZE) break;
  }

  logger.info('Platform announcement fan-out complete', { subject, processed, total });
}
