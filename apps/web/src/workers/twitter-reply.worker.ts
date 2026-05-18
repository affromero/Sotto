import { Job } from 'bullmq';
import { ReplyTwitterPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { replyToTweet } from '@/lib/twitter';
import { getPublicAppBaseUrl, podcastUrl as buildPodcastPath } from '@/lib/urls';
import { logger } from '@/lib/logger';

export async function processTwitterReply(job: Job<ReplyTwitterPayload>): Promise<void> {
  const { podcastId, tweetMentionId, originalTweetId } = job.data;
  await job.updateProgress(10);
  const appUrl = getPublicAppBaseUrl();

  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: {
      title: true,
      duration: true,
      status: true,
      slug: true,
      visibility: true,
      user: { select: { handle: true } },
    },
  });

  if (podcast.status === 'FAILED') {
    // Notify the user their generation failed
    const failureText = `Sorry, we couldn't generate your podcast. Try again or visit ${appUrl} to create one manually.`;

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

  if (podcast.status !== 'READY') {
    // Podcast is mid-generation (retry in progress) — skip, reply will be queued when done
    logger.info('Skipping Twitter reply — podcast not in terminal state', {
      podcastId,
      status: podcast.status,
    });
    return;
  }

  await job.updateProgress(30);

  if (podcast.visibility === 'PRIVATE' || podcast.visibility === 'UNLISTED') {
    const genericReplyText = 'Your podcast is ready! Check your dashboard to listen.';
    const replyId = await replyToTweet(originalTweetId, genericReplyText);
    await prisma.tweetMention.update({
      where: { id: tweetMentionId },
      data: { status: 'REPLIED', replyTweetId: replyId },
    });
    await job.updateProgress(100);
    logger.info('Twitter reply posted (private/unlisted — no URL)', {
      podcastId,
      originalTweetId,
      replyTweetId: replyId,
      visibility: podcast.visibility,
    });
    return;
  }

  // Compose reply (must be under 280 chars)
  const durationMin = podcast.duration ? Math.round(podcast.duration / 60) : 0;
  const durationStr = durationMin > 0 ? ` (${durationMin} min)` : '';
  const podcastUrl = `${appUrl}${buildPodcastPath({ id: podcastId, slug: podcast.slug }, podcast.user.handle)}`;

  // Template: 'Your podcast is ready! "TITLE"DURATION\n\nListen: URL'
  // Reserve space for fixed parts + URL + duration, then fit the title
  const fixedLength =
    'Your podcast is ready! ""'.length +
    durationStr.length +
    '\n\nListen: '.length +
    podcastUrl.length;
  const maxTitleLength = 280 - fixedLength;
  const title =
    podcast.title.length > maxTitleLength
      ? podcast.title.substring(0, maxTitleLength - 3) + '...'
      : podcast.title;

  const replyText = `Your podcast is ready! "${title}"${durationStr}\n\nListen: ${podcastUrl}`;

  await job.updateProgress(50);

  // Idempotency: skip if reply was already posted (prevents duplicates on BullMQ retry)
  const mention = await prisma.tweetMention.findUnique({
    where: { id: tweetMentionId },
    select: { replyTweetId: true, status: true },
  });
  if (mention?.replyTweetId) {
    logger.info('Reply already posted, skipping', {
      podcastId,
      replyTweetId: mention.replyTweetId,
    });
    return;
  }

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
