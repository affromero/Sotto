import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getTweet, getThread } from '@/lib/twitter';
import { parseThreadIntent, parseTweetIntent } from '@/lib/tweet-parser';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair } from '@/lib/elevenlabs';
import { logger } from '@/lib/logger';
import type { AdminThreadToPodcastPayload } from '@/lib/queue';

const TWEET_URL_REGEX = /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/;

export async function processAdminThreadToPodcast(
  job: Job<AdminThreadToPodcastPayload>
): Promise<void> {
  const { tweetUrl, message } = job.data;

  // 1. Parse tweet URL to extract tweet ID
  const match = tweetUrl.match(TWEET_URL_REGEX);
  if (!match) {
    throw new Error(`Invalid tweet URL: ${tweetUrl}`);
  }
  const tweetId = match[1];

  await job.updateProgress(10);

  // 2. Fetch the tweet to get conversation_id
  const tweet = await getTweet(tweetId);
  if (!tweet) {
    throw new Error(`Tweet not found: ${tweetId}`);
  }

  await job.updateProgress(20);

  // 3. Fetch full thread
  const conversationId = tweet.conversation_id || tweet.id;
  const threadData = await getThread(conversationId);

  await job.updateProgress(40);

  // 4. Parse intent from admin message (if provided) or tweet/thread text
  let parsed;
  if (message) {
    parsed = await parseTweetIntent(message);
  } else if (threadData && threadData.replies.length >= 2) {
    const mentionAsThreadTweet = {
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      authorUsername: 'unknown',
      authorName: 'Unknown',
      urls: tweet.entities?.urls?.map((u) => u.expanded_url) ?? [],
      createdAt: tweet.created_at,
    };
    parsed = await parseThreadIntent(mentionAsThreadTweet, threadData);
  } else {
    parsed = await parseTweetIntent(tweet.text);
  }

  await job.updateProgress(60);

  // 5. Resolve @sotto system user
  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    throw new Error('@sotto system account not found. Run prisma db seed.');
  }

  // 6. Create podcast as @sotto
  const voicePair = selectVoicePair(tweetId);

  const isThreadPodcast = threadData && threadData.replies.length >= 2;
  const tone = parsed.isDebate ? 'socratic' : parsed.tone;
  const durationTarget = parsed.durationTarget ?? (isThreadPodcast ? 15 : 10);

  // Build source text for threads
  let sourceText: string | undefined;
  if (isThreadPodcast && threadData) {
    const sections: string[] = ['## Twitter/X Thread Discussion', ''];
    if (parsed.viewpoints && parsed.viewpoints.length > 0) {
      sections.push('### Viewpoints Identified:');
      for (const v of parsed.viewpoints) {
        sections.push(`- ${v}`);
      }
      sections.push('');
    }
    sections.push('### Thread Conversation:');
    sections.push(
      `**Original post by @${threadData.rootTweet.authorUsername}:** ${threadData.rootTweet.text}`
    );
    for (const reply of threadData.replies) {
      sections.push(`**@${reply.authorUsername}:** ${reply.text}`);
    }
    sourceText = sections.join('\n');
  }

  const podcast = await prisma.podcast.create({
    data: {
      userId: sottoUser.id,
      title: parsed.title,
      topic: parsed.topic,
      status: 'EXTRACTING',
      source: 'TWITTER',
      sourceTweetId: tweetId,
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
          tone,
          focusAreas: parsed.focusAreas,
          durationTarget,
          sourceUrl: parsed.sourceUrl,
        },
      },
    },
  });

  await job.updateProgress(80);

  // 7. Kick off generation pipeline
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, {
    podcastId: podcast.id,
    userId: sottoUser.id,
    sourceUrl: parsed.sourceUrl,
    sourceText,
  });

  await job.updateProgress(100);
  logger.info('Admin thread-to-podcast created', {
    podcastId: podcast.id,
    tweetId,
    topic: parsed.topic,
    isThread: String(!!isThreadPodcast),
  });
}
