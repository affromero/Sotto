import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getTweet, getThread } from '@/lib/twitter';
import { parseThreadIntent, parseTweetIntent } from '@/lib/tweet-parser';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair } from '@/lib/elevenlabs';
import { lookupParticipantCredentials } from '@/lib/credential-lookup';
import { formatThreadAsSourceText, getVerifiedParticipants } from '@/lib/twitter-utils';
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

  // 4. Determine if this qualifies as a thread podcast
  const isThreadPodcast = threadData !== null && (
    (threadData.isSelfAuthored && threadData.replies.length >= 1) ||
    (!threadData.isSelfAuthored && threadData.replies.length >= 2)
  );

  // 5. Always parse thread/tweet for content first, then merge admin overrides
  let parsed;
  const mentionAsThreadTweet = {
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    authorUsername: 'unknown',
    authorName: 'Unknown',
    urls: tweet.entities?.urls?.map((u: { expanded_url: string }) => u.expanded_url) ?? [],
    createdAt: tweet.created_at,
  };

  const contentParsed = isThreadPodcast && threadData
    ? await parseThreadIntent(mentionAsThreadTweet, threadData)
    : await parseTweetIntent(tweet.text);

  if (message) {
    const overrides = await parseTweetIntent(message);
    parsed = {
      ...contentParsed,
      depth: overrides.depth,
      audienceLevel: overrides.audienceLevel,
      tone: overrides.tone,
      audience: overrides.audience ?? contentParsed.audience,
      durationTarget: overrides.durationTarget ?? contentParsed.durationTarget,
    };
  } else {
    parsed = contentParsed;
  }

  await job.updateProgress(50);

  // 5b. Look up credentials for verified thread participants
  let participantCredentials: import('@/lib/credential-lookup').ParticipantCredential[] = [];
  if (isThreadPodcast && threadData) {
    const verifiedParticipants = getVerifiedParticipants(threadData);
    if (verifiedParticipants.length > 0) {
      participantCredentials = await lookupParticipantCredentials(verifiedParticipants);
    }
  }

  await job.updateProgress(60);

  // 6. Resolve @sotto system user
  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    throw new Error('@sotto system account not found. Run prisma db seed.');
  }

  // 7. Create podcast as @sotto
  const voicePair = selectVoicePair(tweetId);

  const tone = parsed.isDebate ? 'socratic' : parsed.tone;
  const durationTarget = parsed.durationTarget ?? (isThreadPodcast ? 15 : 10);

  // Build source text for threads
  const sourceText = isThreadPodcast && threadData
    ? formatThreadAsSourceText(threadData, parsed, participantCredentials)
    : undefined;

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

  await job.updateData({ ...job.data, podcastId: podcast.id });
  await job.updateProgress(80);

  // 8. Kick off generation pipeline
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
