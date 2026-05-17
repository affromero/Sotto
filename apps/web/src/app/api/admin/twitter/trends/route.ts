import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { searchPopularTweets } from '@/lib/twitter';
import { engagementScore, filterQualityTweets } from '@/lib/twitter-utils';
import { parseTweetIntent } from '@/lib/tweet-parser';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair } from '@/lib/elevenlabs';
import { getTwitterConfig } from '@/lib/twitter-config';
import { trendGenerateSchema, trendFilterSchema } from '@/lib/validations';
import { generatePodcastSlug } from '@/lib/slugify';
import type { TwitterTweet, TrendTopic, EnrichedTrendTweet, TweetAuthor } from '@/types/twitter';

import { errorResponse } from '@/lib/api-response';

function enrichTweet(
  tweet: TwitterTweet,
  authorMap: Map<string, TweetAuthor>
): EnrichedTrendTweet {
  const author = authorMap.get(tweet.author_id);
  const m = tweet.public_metrics;
  return {
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    authorUsername: author?.username ?? 'unknown',
    authorName: author?.name ?? 'Unknown',
    authorVerified: author?.verified,
    authorVerifiedType: author?.verifiedType,
    engagementScore: engagementScore(tweet),
    likeCount: m?.like_count ?? 0,
    retweetCount: m?.retweet_count ?? 0,
    replyCount: m?.reply_count ?? 0,
    createdAt: tweet.created_at,
    tweetUrl: `https://x.com/${author?.username ?? 'i'}/status/${tweet.id}`,
  };
}

export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filterResult = trendFilterSchema.safeParse(params);
  if (!filterResult.success) {
    return errorResponse(filterResult.error.flatten(), 400);
  }

  const filters = filterResult.data;
  const config = await getTwitterConfig();
  const maxPerQuery = filters.maxPerQuery ?? 20;
  const trends: TrendTopic[] = [];

  for (const baseQuery of config.trendSearchQueries) {
    try {
      const query = filters.lang ? `${baseQuery} lang:${filters.lang}` : baseQuery;
      const { tweets, authorMap } = await searchPopularTweets(query, maxPerQuery);

      // Filter out retweets, zero-like tweets, and tweets that only matched via author name
      const qualityTweets = filterQualityTweets(tweets, baseQuery);

      if (qualityTweets.length > 0) {
        let enriched = qualityTweets.map((t) => enrichTweet(t, authorMap));

        if (filters.verified) {
          enriched = enriched.filter((t) => t.authorVerified);
        }

        if (filters.minEngagement !== undefined) {
          enriched = enriched.filter((t) => t.engagementScore >= filters.minEngagement!);
        }

        enriched.sort((a, b) => b.engagementScore - a.engagementScore);

        if (enriched.length > 0) {
          trends.push({
            query: baseQuery,
            tweets: enriched,
            totalTweetCount: qualityTweets.length,
          });
        }
      }
    } catch {
      // Skip failed queries
    }
  }

  trends.sort((a, b) => (b.tweets[0]?.engagementScore ?? 0) - (a.tweets[0]?.engagementScore ?? 0));

  return NextResponse.json({ trends });
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = trendGenerateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    return errorResponse('@sotto system account not found', 404);
  }

  const config = await getTwitterConfig();
  const intent = await parseTweetIntent(parsed.data.tweetText, undefined, {
    userId: sottoUser.id,
    aiModel: config.defaultAiModel ?? undefined,
  });
  const voicePair = selectVoicePair(parsed.data.tweetId || intent.title);
  const slug = await generatePodcastSlug(intent.title, sottoUser.id, prisma);

  const podcast = await prisma.podcast.create({
    data: {
      userId: sottoUser.id,
      title: intent.title,
      topic: intent.topic,
      slug,
      status: 'EXTRACTING',
      source: 'TWITTER',
      sourceTweetId: parsed.data.tweetId,
      visibility: 'PUBLIC',
      voices: {
        createMany: {
          data: [
            { speaker: 'HOST', voiceId: voicePair.host.id },
            { speaker: 'EXPERT', voiceId: voicePair.expert.id },
          ],
        },
      },
      discovery: {
        create: {
          userId: sottoUser.id,
          topic: intent.topic,
          depth: intent.depth,
          audienceLevel: intent.audienceLevel,
          tone: intent.tone,
          focusAreas: intent.focusAreas,
          durationTarget: 10,
          sourceUrl: intent.sourceUrl,
        },
      },
    },
  });

  await prisma.twitterAutoTweet.create({
    data: { podcastId: podcast.id, trigger: 'trend', status: 'pending' },
  });

  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, {
    podcastId: podcast.id,
    userId: sottoUser.id,
    sourceUrl: intent.sourceUrl,
  });

  return NextResponse.json({ podcastId: podcast.id }, { status: 201 });
}
