import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { postTweet } from '@/lib/twitter';
import { getTwitterConfig } from '@/lib/twitter-config';
import { getPublicAppBaseUrl, podcastUrl as buildPodcastPath } from '@/lib/urls';
import { logger } from '@/lib/logger';
import type { AutoTweetPayload } from '@/lib/queue';

function interpolateTemplate(
  template: string,
  vars: { title: string; topic: string; url: string }
): string {
  let text = template
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{topic\}\}/g, vars.topic)
    .replace(/\{\{url\}\}/g, vars.url);

  // Truncate to 280 chars (Twitter limit) — preserve the URL at the end
  if (text.length > 280) {
    const urlSuffix = `\n\n${vars.url}`;
    const maxBodyLength = 280 - urlSuffix.length;
    const bodyWithoutUrl = text.slice(0, text.lastIndexOf(vars.url)).trimEnd();
    text = bodyWithoutUrl.slice(0, maxBodyLength).trimEnd() + urlSuffix;
  }

  return text;
}

export async function processAutoTweet(job: Job<AutoTweetPayload>): Promise<void> {
  const { podcastId, trigger } = job.data;

  // CAS: atomically claim the pending record — prevents duplicate posts on retry
  const claimed = await prisma.twitterAutoTweet.updateMany({
    where: { podcastId, trigger, status: 'pending' },
    data: { status: 'posting' },
  });

  if (claimed.count === 0) {
    logger.info('No pending auto-tweet to claim (already claimed or posted)', {
      podcastId,
      trigger,
    });
    return;
  }

  const autoTweet = await prisma.twitterAutoTweet.findFirst({
    where: { podcastId, trigger, status: 'posting' },
    orderBy: { createdAt: 'desc' },
  });

  if (!autoTweet) {
    return;
  }

  try {
    const podcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { title: true, topic: true, slug: true, user: { select: { handle: true } } },
    });

    const config = await getTwitterConfig();
    const appUrl = getPublicAppBaseUrl();

    const tweetText = interpolateTemplate(config.tweetTemplate, {
      title: podcast.title,
      topic: podcast.topic.length > 100 ? podcast.topic.slice(0, 97) + '...' : podcast.topic,
      url: `${appUrl}${buildPodcastPath({ id: podcastId, slug: podcast.slug }, podcast.user.handle)}`,
    });

    const tweetId = await postTweet(tweetText);

    await prisma.twitterAutoTweet.update({
      where: { id: autoTweet.id },
      data: { tweetId, tweetText, status: 'posted' },
    });

    logger.info('Auto-tweet posted', { podcastId, tweetId, trigger });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await prisma.twitterAutoTweet.update({
      where: { id: autoTweet.id },
      data: { status: 'failed', errorMessage },
    });

    logger.error('Auto-tweet failed', { podcastId, trigger, error: errorMessage });
    throw err;
  }
}
