import { Job } from 'bullmq';
import { ReplyTwitterPayload } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { replyToTweet } from '@/lib/twitter';
import { logger } from '@/lib/logger';

const SOTTO_APP_URL = process.env.NEXTAUTH_URL || 'https://sotto.fm';

export async function processTwitterReply(job: Job<ReplyTwitterPayload>): Promise<void> {
  const { podcastId, tweetMentionId, originalTweetId } = job.data;
  await job.updateProgress(10);

  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { title: true, duration: true, status: true },
  });

  if (podcast.status === 'FAILED') {
    // Notify the user their generation failed
    const failureText = `Sorry, we couldn't generate your podcast. Try again or visit ${SOTTO_APP_URL} to create one manually.`;

    try {
      const replyId = await replyToTweet(originalTweetId, failureText);
      await prisma.tweetMention.update({
        where: { id: tweetMentionId },
        data: { status: 'FAILED', replyTweetId: replyId },
      });
    } catch (err) {
      logger.error('Failed to post failure reply', {
        tweetMentionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  await job.updateProgress(30);

  // Compose reply (must be under 280 chars)
  const durationMin = podcast.duration ? Math.round(podcast.duration / 60) : 0;
  const durationStr = durationMin > 0 ? ` (${durationMin} min)` : '';
  const podcastUrl = `${SOTTO_APP_URL}/podcast/${podcastId}`;

  // Template: 'Your podcast is ready! "TITLE"DURATION\n\nListen: URL'
  // Reserve space for fixed parts + URL + duration, then fit the title
  const fixedLength = 'Your podcast is ready! ""'.length + durationStr.length + '\n\nListen: '.length + podcastUrl.length;
  const maxTitleLength = 280 - fixedLength;
  const title =
    podcast.title.length > maxTitleLength
      ? podcast.title.substring(0, maxTitleLength - 3) + '...'
      : podcast.title;

  const replyText = `Your podcast is ready! "${title}"${durationStr}\n\nListen: ${podcastUrl}`;

  await job.updateProgress(50);

  const replyId = await replyToTweet(originalTweetId, replyText);

  await job.updateProgress(80);

  await prisma.tweetMention.update({
    where: { id: tweetMentionId },
    data: { status: 'REPLIED', replyTweetId: replyId },
  });

  await job.updateProgress(100);
  logger.info('Twitter reply posted', {
    podcastId,
    originalTweetId,
    replyTweetId: replyId,
  });
}
