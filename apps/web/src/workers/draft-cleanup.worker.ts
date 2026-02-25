import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function processDraftCleanup(_job: Job): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await prisma.podcast.deleteMany({
    where: {
      status: 'DRAFT',
      updatedAt: { lt: thirtyDaysAgo },
    },
  });

  if (result.count > 0) {
    logger.info('Cleaned up stale drafts', { count: String(result.count) });
  }
}
