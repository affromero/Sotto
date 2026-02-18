import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { searchPopularTweets } from '@/lib/twitter';
import { getTwitterConfig } from '@/lib/twitter-config';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { parseTweetIntent } from '@/lib/tweet-parser';
import { selectVoicePair } from '@/lib/elevenlabs';
import { logger } from '@/lib/logger';
import type { PollTwitterTrendsPayload } from '@/lib/queue';
import type { TwitterTweet } from '@/types/twitter';

function engagementScore(tweet: TwitterTweet): number {
  const m = tweet.public_metrics;
  if (!m) return 0;
  return m.like_count + m.retweet_count * 2 + m.reply_count;
}

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function topicSimilarity(a: string, b: string): number {
  const aWords = extractKeywords(a);
  const bWords = extractKeywords(b);
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap++;
  }
  return overlap / Math.min(aWords.size, bWords.size);
}

export async function processTrendPoll(job: Job<PollTwitterTrendsPayload>): Promise<void> {
  const config = await getTwitterConfig();

  if (!config.trendPollingEnabled) {
    logger.info('Trend polling disabled — skipping');
    return;
  }

  // Check today's trend podcast count
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayTrendCount = await prisma.twitterAutoTweet.count({
    where: {
      trigger: 'trend',
      createdAt: { gte: todayStart },
    },
  });

  if (todayTrendCount >= config.maxTrendPodcastsPerDay) {
    logger.info('Daily trend podcast limit reached', {
      count: String(todayTrendCount),
      max: String(config.maxTrendPodcastsPerDay),
    });
    return;
  }

  const remainingBudget = config.maxTrendPodcastsPerDay - todayTrendCount;

  // Gather top tweets across all search queries
  const allTweets: Array<{ tweet: TwitterTweet; query: string }> = [];

  for (const query of config.trendSearchQueries) {
    try {
      const tweets = await searchPopularTweets(query, 10);
      for (const tweet of tweets) {
        allTweets.push({ tweet, query });
      }
    } catch (err) {
      logger.error('Failed to search trending tweets', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (allTweets.length === 0) {
    logger.info('No trending tweets found');
    return;
  }

  // Sort by engagement
  allTweets.sort((a, b) => engagementScore(b.tweet) - engagementScore(a.tweet));

  // Deduplicate by topic similarity
  const selected: Array<{ tweet: TwitterTweet; query: string }> = [];
  for (const candidate of allTweets) {
    if (selected.length >= remainingBudget) break;

    const isDuplicate = selected.some(
      (s) => topicSimilarity(s.tweet.text, candidate.tweet.text) > 0.5
    );
    if (isDuplicate) continue;

    selected.push(candidate);
  }

  // Resolve @sotto system user
  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    logger.error('Cannot create trend podcasts — @sotto system user not found');
    return;
  }

  // Create podcasts for selected topics
  for (const { tweet } of selected) {
    try {
      const parsed = await parseTweetIntent(tweet.text);

      const voicePair = selectVoicePair(tweet.id);

      const podcast = await prisma.podcast.create({
        data: {
          userId: sottoUser.id,
          title: parsed.title,
          topic: parsed.topic,
          status: 'EXTRACTING',
          source: 'TWITTER',
          sourceTweetId: tweet.id,
          hostVoiceId: voicePair.host.id,
          expertVoiceId: voicePair.expert.id,
          visibility: 'PUBLIC',
          discovery: {
            create: {
              userId: sottoUser.id,
              topic: parsed.topic,
              depth: parsed.depth,
              audienceLevel: parsed.audienceLevel,
              audience: parsed.audience ?? 'general',
              tone: parsed.tone,
              focusAreas: parsed.focusAreas,
              durationTarget: parsed.durationTarget ?? 10,
              sourceUrl: parsed.sourceUrl,
            },
          },
        },
      });

      // Create auto-tweet record for when podcast reaches READY
      await prisma.twitterAutoTweet.create({
        data: {
          podcastId: podcast.id,
          trigger: 'trend',
          status: 'pending',
        },
      });

      // Kick off generation pipeline
      await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, {
        podcastId: podcast.id,
        userId: sottoUser.id,
        sourceUrl: parsed.sourceUrl,
      });

      logger.info('Trend podcast created', {
        podcastId: podcast.id,
        topic: parsed.topic,
        sourceTweetId: tweet.id,
      });
    } catch (err) {
      logger.error('Failed to create trend podcast', {
        tweetId: tweet.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await job.updateProgress(100);
  logger.info('Trend poll complete', { selected: String(selected.length) });
}
