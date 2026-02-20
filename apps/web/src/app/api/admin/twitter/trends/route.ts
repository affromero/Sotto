import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { searchPopularTweets } from '@/lib/twitter';
import { parseTweetIntent } from '@/lib/tweet-parser';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair } from '@/lib/elevenlabs';
import { getTwitterConfig } from '@/lib/twitter-config';
import { trendGenerateSchema } from '@/lib/validations';
import type { TwitterTweet, TrendTopic } from '@/types/twitter';

function engagementScore(tweet: TwitterTweet): number {
  const m = tweet.public_metrics;
  if (!m) return 0;
  return m.like_count + m.retweet_count * 2 + m.reply_count;
}

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const config = await getTwitterConfig();
  const trends: TrendTopic[] = [];

  for (const query of config.trendSearchQueries) {
    try {
      const tweets = await searchPopularTweets(query, 10);
      if (tweets.length > 0) {
        const sorted = tweets.sort((a, b) => engagementScore(b) - engagementScore(a));
        trends.push({
          query,
          topTweet: sorted[0],
          engagementScore: engagementScore(sorted[0]),
          tweetCount: tweets.length,
        });
      }
    } catch {
      // Skip failed queries
    }
  }

  trends.sort((a, b) => b.engagementScore - a.engagementScore);

  return NextResponse.json({ trends });
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = trendGenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    return NextResponse.json(
      { error: '@sotto system account not found' },
      { status: 404 }
    );
  }

  const intent = await parseTweetIntent(parsed.data.tweetText);
  const voicePair = selectVoicePair(parsed.data.tweetId || intent.title);

  const podcast = await prisma.podcast.create({
    data: {
      userId: sottoUser.id,
      title: intent.title,
      topic: intent.topic,
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
