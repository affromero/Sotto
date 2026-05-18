import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { EmailDeliveryError, assertEmailDeliveryConfigured, sendEmail } from '@/lib/email';
import { buildWeeklyDigestEmail } from '@/lib/email-templates';
import { logger } from '@/lib/logger';

export interface EmailDigestResult {
  sent: number;
  failed: number;
  total: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function processEmailDigest(job: Job): Promise<EmailDigestResult> {
  logger.info('Starting weekly email digest');

  // Get top 5 podcasts from last 7 days by play count
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const topPodcasts = await prisma.podcast.findMany({
    where: {
      status: 'READY',
      visibility: 'PUBLIC',
      createdAt: { gte: sevenDaysAgo },
    },
    orderBy: { playCount: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      topic: true,
      slug: true,
      user: { select: { name: true, handle: true } },
    },
  });

  if (topPodcasts.length === 0) {
    logger.info('No podcasts to include in digest — skipping');
    return { sent: 0, failed: 0, total: 0 };
  }

  const digestPodcasts = topPodcasts.map((p) => ({
    id: p.id,
    title: p.title,
    topic: p.topic,
    slug: p.slug,
    creatorHandle: p.user.handle,
    creatorName: p.user.name,
  }));

  // Get non-unsubscribed waitlist entries
  const waitlistEntries = await prisma.waitlist.findMany({
    where: { unsubscribed: false },
    select: { email: true },
  });

  let sent = 0;
  let failed = 0;
  const failures: Array<{ email: string; error: string }> = [];

  if (waitlistEntries.length > 0) {
    assertEmailDeliveryConfigured();
  }

  // Send in batches of 10
  for (let i = 0; i < waitlistEntries.length; i += 10) {
    const batch = waitlistEntries.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async (entry) => {
        const { subject, html } = buildWeeklyDigestEmail(entry.email, digestPodcasts);
        try {
          await sendEmail({ to: entry.email, subject, html });
          return { email: entry.email, status: 'sent' as const };
        } catch (error) {
          return {
            email: entry.email,
            status: 'failed' as const,
            error: getErrorMessage(error),
          };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'sent') {
        sent++;
      } else {
        failed++;
        failures.push({ email: result.email, error: result.error });
      }
    }

    await job.updateProgress(Math.round(((i + batch.length) / waitlistEntries.length) * 100));
  }

  if (failures.length > 0) {
    logger.error('Weekly email digest failed for one or more recipients', {
      sent,
      failed,
      total: waitlistEntries.length,
      failures,
    });
    throw new EmailDeliveryError(
      `Weekly email digest failed for ${failures.length} recipient(s)`,
      failures
    );
  }

  logger.info('Weekly email digest complete', { sent, failed, total: waitlistEntries.length });
  return { sent, failed, total: waitlistEntries.length };
}
