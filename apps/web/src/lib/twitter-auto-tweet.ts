import { prisma } from './prisma';
import { getTwitterConfig } from './twitter-config';
import { addJob, JobType, twitterAutoTweetQueue } from './queue';
import { logger } from './logger';

/**
 * Check if a podcast has crossed auto-tweet thresholds.
 * Called after like, fork, and play count increments (fire-and-forget).
 * Must be called AFTER the transaction that increments the counter commits.
 */
export async function checkAutoTweetThreshold(podcastId: string): Promise<void> {
  const config = await getTwitterConfig();

  if (!config.autoTweetEnabled) {
    return;
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      visibility: true,
      playCount: true,
      likeCount: true,
      forkCount: true,
    },
  });

  if (!podcast || podcast.visibility !== 'PUBLIC') {
    return;
  }

  // Check if already auto-tweeted via threshold
  const existing = await prisma.twitterAutoTweet.findFirst({
    where: { podcastId, trigger: 'threshold' },
  });

  if (existing) {
    return;
  }

  // Check if any threshold is met (OR logic)
  const meetsThreshold =
    podcast.playCount >= config.minPlays ||
    podcast.likeCount >= config.minLikes ||
    podcast.forkCount >= config.minForks;

  if (!meetsThreshold) {
    return;
  }

  await prisma.twitterAutoTweet.create({
    data: { podcastId, trigger: 'threshold', status: 'pending' },
  });

  await addJob(twitterAutoTweetQueue, JobType.AUTO_TWEET, {
    podcastId,
    trigger: 'threshold' as const,
  });

  logger.info('Auto-tweet threshold met', {
    podcastId,
    likes: String(podcast.likeCount),
    plays: String(podcast.playCount),
    forks: String(podcast.forkCount),
  });
}

/**
 * Manually trigger a tweet for a podcast (admin action).
 * Returns the auto-tweet record ID.
 */
export async function manualTweet(podcastId: string): Promise<string> {
  const record = await prisma.twitterAutoTweet.create({
    data: { podcastId, trigger: 'manual', status: 'pending' },
  });

  await addJob(twitterAutoTweetQueue, JobType.AUTO_TWEET, {
    podcastId,
    trigger: 'manual' as const,
  });

  return record.id;
}
