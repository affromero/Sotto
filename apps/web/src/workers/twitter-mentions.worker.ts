import { Job } from 'bullmq';
import { PollTwitterMentionsPayload, addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { getMentions, getTweet, replyToTweet } from '@/lib/twitter';
import { parseTweetIntent } from '@/lib/tweet-parser';
import { getAiKey } from '@/lib/byok';
import { canResolveAi } from '@/lib/providers/ai';
import { selectVoicePair } from '@/lib/elevenlabs';
import { logger } from '@/lib/logger';
import type { TwitterTweet } from '@/types/twitter';

const REDIS_CURSOR_KEY = 'twitter:last_processed_tweet_id';
const REDIS_CTA_PREFIX = 'twitter:cta_sent:';
const SOTTO_APP_URL = process.env.NEXTAUTH_URL || 'https://sotto.fm';

export async function processTwitterMentions(job: Job<PollTwitterMentionsPayload>): Promise<void> {
  const redis = getRedisClient();

  const sinceId = await redis.get(REDIS_CURSOR_KEY);
  const mentions = await getMentions(sinceId ?? undefined);

  if (mentions.length === 0) {
    return;
  }

  // Process oldest-first so cursor advances correctly
  const sorted = [...mentions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  for (const tweet of sorted) {
    try {
      await processSingleMention(tweet);
    } catch (err) {
      logger.error('Error processing tweet mention', {
        tweetId: tweet.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update cursor to the highest tweet ID we processed
  const maxId = sorted[sorted.length - 1].id;
  await redis.set(REDIS_CURSOR_KEY, maxId);

  await job.updateProgress(100);
  logger.info('Twitter mentions poll complete', { processed: String(sorted.length) });
}

async function processSingleMention(tweet: TwitterTweet): Promise<void> {
  // 1. Dedup: skip if we already have this tweet
  const existing = await prisma.tweetMention.findUnique({
    where: { tweetId: tweet.id },
  });
  if (existing) {
    return;
  }

  // 2. Look up Sotto user by Twitter numeric user ID (immutable)
  const account = await prisma.account.findFirst({
    where: {
      provider: 'twitter',
      providerAccountId: tweet.author_id,
    },
    select: { userId: true },
  });

  if (!account) {
    // Unlinked user: send CTA once per author, then ignore
    await handleUnlinkedUser(tweet);
    return;
  }

  const userId = account.userId;

  // 3. Check if Twitter integration is enabled for this user
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      twitterEnabled: true,
      preferredHostVoiceId: true,
      preferredExpertVoiceId: true,
    },
  });

  if (!user.twitterEnabled) {
    await prisma.tweetMention.create({
      data: {
        tweetId: tweet.id,
        authorId: tweet.author_id,
        text: tweet.text,
        status: 'IGNORED',
        userId,
        errorMessage: 'Twitter integration disabled by user',
      },
    });
    return;
  }

  // 4. Check BYOK key availability
  const hasAi = await canResolveAi(userId);
  if (!hasAi) {
    await prisma.tweetMention.create({
      data: {
        tweetId: tweet.id,
        authorId: tweet.author_id,
        text: tweet.text,
        status: 'IGNORED',
        userId,
        errorMessage: 'No AI provider configured (missing BYOK key)',
      },
    });
    return;
  }

  // 5. Create TweetMention record as PARSING
  const mention = await prisma.tweetMention.create({
    data: {
      tweetId: tweet.id,
      authorId: tweet.author_id,
      text: tweet.text,
      status: 'PARSING',
      userId,
      parentTweetId: getParentTweetId(tweet),
    },
  });

  try {
    // 6. Fetch parent tweet for reply context
    let parentText: string | undefined;
    const parentTweetId = getParentTweetId(tweet);
    if (parentTweetId) {
      const parentTweet = await getTweet(parentTweetId);
      if (parentTweet) {
        parentText = parentTweet.text;
      }
    }

    // 7. Resolve user's AI key for BYOK passthrough
    const aiKey = await getAiKey(userId);

    // 8. Parse intent via Claude
    const parsed = await parseTweetIntent(tweet.text, parentText, aiKey?.apiKey);

    await prisma.tweetMention.update({
      where: { id: mention.id },
      data: { parsedTopic: parsed.topic, status: 'GENERATING' },
    });

    // 9. Determine voice IDs
    const tempPodcastId = mention.id; // use mention ID as seed for voice selection
    const voicePair = selectVoicePair(tempPodcastId);
    const hostVoiceId = user.preferredHostVoiceId ?? voicePair.host.id;
    const expertVoiceId = user.preferredExpertVoiceId ?? voicePair.expert.id;

    // 10. Create Podcast + Discovery records
    const podcast = await prisma.podcast.create({
      data: {
        userId,
        title: parsed.title,
        topic: parsed.topic,
        status: 'EXTRACTING',
        source: 'TWITTER',
        sourceTweetId: tweet.id,
        hostVoiceId,
        expertVoiceId,
        visibility: 'PUBLIC',
        discovery: {
          create: {
            userId,
            topic: parsed.topic,
            depth: parsed.depth,
            audienceLevel: parsed.audienceLevel,
            tone: parsed.tone,
            focusAreas: parsed.focusAreas,
            durationTarget: 10,
            sourceUrl: parsed.sourceUrl,
          },
        },
      },
      include: { discovery: true },
    });

    // 11. Link mention to podcast
    await prisma.tweetMention.update({
      where: { id: mention.id },
      data: { podcastId: podcast.id },
    });

    // 12. Kick off the generation pipeline
    await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, {
      podcastId: podcast.id,
      userId,
      sourceUrl: parsed.sourceUrl,
    });

    logger.info('Twitter mention processed — podcast created', {
      tweetId: tweet.id,
      podcastId: podcast.id,
      topic: parsed.topic,
    });
  } catch (err) {
    await prisma.tweetMention.update({
      where: { id: mention.id },
      data: {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

async function handleUnlinkedUser(tweet: TwitterTweet): Promise<void> {
  const redis = getRedisClient();
  const ctaKey = `${REDIS_CTA_PREFIX}${tweet.author_id}`;

  // Only send CTA once per Twitter user ID (no expiry)
  const alreadySent = await redis.exists(ctaKey);
  if (alreadySent) {
    return;
  }

  try {
    await replyToTweet(
      tweet.id,
      `Sign up at ${SOTTO_APP_URL} and connect your Twitter account to generate podcasts from tweets!`
    );
    await redis.set(ctaKey, '1');

    logger.info('Sent CTA reply to unlinked Twitter user', {
      tweetId: tweet.id,
      authorId: tweet.author_id,
    });
  } catch (err) {
    logger.error('Failed to send CTA reply', {
      tweetId: tweet.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function getParentTweetId(tweet: TwitterTweet): string | undefined {
  if (!tweet.referenced_tweets) {
    return undefined;
  }
  const repliedTo = tweet.referenced_tweets.find((r) => r.type === 'replied_to');
  return repliedTo?.id;
}
