import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { buildWeeklyDigestEmail } from '@/lib/email-templates';
import { logger } from '@/lib/logger';

export async function processEmailDigest(job: Job): Promise<{ sent: number; skipped: number }> {
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
    return { sent: 0, skipped: 0 };
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
  let skipped = 0;

  // Send in batches of 10
  for (let i = 0; i < waitlistEntries.length; i += 10) {
    const batch = waitlistEntries.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const { subject, html } = buildWeeklyDigestEmail(entry.email, digestPodcasts);
        const success = await sendEmail({ to: entry.email, subject, html });
        return success;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        sent++;
      } else {
        skipped++;
      }
    }

    await job.updateProgress(Math.round(((i + batch.length) / waitlistEntries.length) * 100));
  }

  logger.info('Weekly email digest complete', { sent, skipped, total: waitlistEntries.length });
  return { sent, skipped };
}
