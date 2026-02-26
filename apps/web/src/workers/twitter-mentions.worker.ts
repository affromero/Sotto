import { Job } from 'bullmq';
import { PollTwitterMentionsPayload, addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { getMentions, getTweet, getThread, replyToTweet, sendDirectMessage } from '@/lib/twitter';
import { parseTweetIntent, parseThreadIntent, resolveModelFromTweet } from '@/lib/tweet-parser';
import { getAiKey, hasByokKey } from '@/lib/byok';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { getModelRequiredPlan } from '@/lib/providers/ai-registry';
import { selectVoicePair } from '@/lib/elevenlabs';
import { lookupParticipantCredentials } from '@/lib/credential-lookup';
import { formatThreadAsSourceText, getVerifiedParticipants } from '@/lib/twitter-utils';
import { extractTwitterVideoTranscript } from '@/lib/twitter-video';
import { logger } from '@/lib/logger';
import type { TwitterTweet, TwitterMedia, TweetParseResult, ThreadData } from '@/types/twitter';
import type { ParticipantCredential } from '@/lib/credential-lookup';

const REDIS_CURSOR_KEY = 'twitter:last_processed_tweet_id';
const REDIS_CTA_PREFIX = 'twitter:cta_sent:';
const SOTTO_APP_URL = process.env.NEXTAUTH_URL || 'https://sotto.fm';

export async function processTwitterMentions(job: Job<PollTwitterMentionsPayload>): Promise<void> {
  const redis = getRedisClient();

  const sinceId = await redis.get(REDIS_CURSOR_KEY);
  const { tweets: mentions, mediaByKey } = await getMentions(sinceId ?? undefined);

  if (mentions.length === 0) {
    return;
  }

  // Process oldest-first so cursor advances correctly
  const sorted = [...mentions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  for (const tweet of sorted) {
    try {
      await processSingleMention(tweet, mediaByKey);
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

async function processSingleMention(tweet: TwitterTweet, mediaByKey: Map<string, TwitterMedia>): Promise<void> {
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
      voicePreferences: { select: { speaker: true, voiceId: true } },
      preferredTtsProvider: true,
      preferredTtsModel: true,
      preferredAiProvider: true,
      preferredAiModel: true,
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

  // 4. Check generation gate (BYOK or free tier)
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    await prisma.tweetMention.create({
      data: {
        tweetId: tweet.id,
        authorId: tweet.author_id,
        text: tweet.text,
        status: 'IGNORED',
        userId,
        errorMessage:
          gate.reason === 'free_tier_exhausted'
            ? 'Free generations exhausted'
            : 'No AI provider configured',
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
    // 6. Resolve user's AI key for BYOK passthrough
    const aiKey = await getAiKey(userId);

    // 7. Detect thread and parse intent accordingly
    const conversationId = tweet.conversation_id || tweet.id;
    const isRootMention = conversationId === tweet.id;
    const hasReplies = tweet.public_metrics?.reply_count && tweet.public_metrics.reply_count > 0;
    let parsed: TweetParseResult;
    let threadData: ThreadData | null = null;

    if (!isRootMention || hasReplies) {
      threadData = await getThread(conversationId);
    }

    const isThreadPodcast = threadData !== null && (
      (threadData.isSelfAuthored && threadData.replies.length >= 1) ||
      (!threadData.isSelfAuthored && threadData.replies.length >= 3)
    );

    if (isThreadPodcast && threadData) {
      // Thread path: parse full conversation
      const mentionAsThreadTweet = {
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id,
        authorUsername: 'unknown',
        authorName: 'Unknown',
        urls: tweet.entities?.urls?.map((u) => u.expanded_url) ?? [],
        createdAt: tweet.created_at,
      };
      parsed = await parseThreadIntent(mentionAsThreadTweet, threadData, aiKey?.apiKey);
    } else {
      // Single-tweet path: existing behavior
      let parentText: string | undefined;
      const parentTweetId = getParentTweetId(tweet);
      if (parentTweetId) {
        const parentResult = await getTweet(parentTweetId);
        if (parentResult) {
          parentText = parentResult.tweet.text;
        }
      }
      parsed = await parseTweetIntent(tweet.text, parentText, aiKey?.apiKey);
    }

    // 7b. Look up credentials for verified thread participants
    let participantCredentials: ParticipantCredential[] = [];
    if (isThreadPodcast && threadData) {
      const verifiedParticipants = getVerifiedParticipants(threadData);
      if (verifiedParticipants.length > 0) {
        participantCredentials = await lookupParticipantCredentials(
          verifiedParticipants,
          aiKey?.apiKey
        );
      }
    }

    // 7c. Resolve user-requested model preferences from tweet
    const tweetModels = resolveModelFromTweet(parsed);
    let effectiveAiModel = user.preferredAiModel ?? undefined;
    let effectiveTtsProvider = user.preferredTtsProvider ?? undefined;
    let effectiveTtsModel = user.preferredTtsModel ?? undefined;
    let modelWarning: string | null = null;

    if (tweetModels.aiModel) {
      const requiredPlan = getModelRequiredPlan(tweetModels.aiModel);
      const userPlan = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { plan: true },
      });
      const isByok = await hasByokKey(userId);

      if (requiredPlan === 'PRO' && userPlan.plan !== 'PRO' && !isByok) {
        modelWarning = `You asked for ${parsed.requestedAiModel} but it requires a Pro plan or BYOK key. Using your default model instead. Set up your API keys at ${SOTTO_APP_URL}/settings/api`;
      } else {
        effectiveAiModel = tweetModels.aiModel;
      }
    }

    if (tweetModels.ttsProvider) {
      effectiveTtsProvider = tweetModels.ttsProvider;
      effectiveTtsModel = undefined; // use provider default
    }

    await prisma.tweetMention.update({
      where: { id: mention.id },
      data: { parsedTopic: parsed.topic, status: 'GENERATING' },
    });

    // 8. Determine voice IDs
    const tempPodcastId = mention.id; // use mention ID as seed for voice selection
    const voicePair = selectVoicePair(tempPodcastId);
    const userHostPref = user.voicePreferences.find(v => v.speaker === 'HOST');
    const userExpertPref = user.voicePreferences.find(v => v.speaker === 'EXPERT');
    const hostVoiceId = userHostPref?.voiceId ?? voicePair.host.id;
    const expertVoiceId = userExpertPref?.voiceId ?? voicePair.expert.id;

    // 9. Build podcast metadata — adjust for threads
    const tone = parsed.isDebate ? 'socratic' : parsed.tone;
    const focusAreas = isThreadPodcast && parsed.viewpoints
      ? [...parsed.focusAreas, ...parsed.viewpoints]
      : parsed.focusAreas;
    const durationTarget = parsed.durationTarget ?? (isThreadPodcast ? 15 : 10);
    let sourceText = isThreadPodcast && threadData
      ? formatThreadAsSourceText(threadData, parsed, participantCredentials)
      : undefined;

    // 9b. Extract video transcript if tweet has video attachments
    const videoTranscript = await extractTwitterVideoTranscript(tweet, mediaByKey);
    if (videoTranscript) {
      logger.info('Appending video transcript to source text', {
        tweetId: tweet.id,
        transcriptLength: String(videoTranscript.length),
      });
      const videoSection = `\n\n---\n\n## Video Transcript\n\n${videoTranscript}`;
      sourceText = sourceText ? `${sourceText}${videoSection}` : videoSection;
    }

    // 10. Create Podcast + Discovery records
    const podcast = await prisma.podcast.create({
      data: {
        userId,
        title: parsed.title,
        topic: parsed.topic,
        status: 'EXTRACTING',
        source: 'TWITTER',
        sourceTweetId: tweet.id,
        voices: {
          createMany: {
            data: [
              { speaker: 'HOST', voiceId: hostVoiceId },
              { speaker: 'EXPERT', voiceId: expertVoiceId },
            ],
          },
        },
        ttsProvider: effectiveTtsProvider,
        ttsModel: effectiveTtsModel,
        aiModel: effectiveAiModel,
        visibility: 'PUBLIC',
        discovery: {
          create: {
            userId,
            topic: parsed.topic,
            depth: parsed.depth,
            audienceLevel: parsed.audienceLevel,
            audience: parsed.audience ?? 'general',
            tone,
            focusAreas,
            durationTarget,
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
      sourceText,
    });

    // Increment free tier counter for non-BYOK users
    if (!gate.isByokUser) {
      const selected = await selectFreeTierProviders(userId);
      await tryIncrementFreeGeneration(userId, gate.dailyLimit, {
        ai: { provider: selected.aiProvider, quota: selected.aiQuota },
        tts: { provider: selected.ttsProvider, quota: selected.ttsQuota },
      });
      // Write selected providers onto the podcast
      await prisma.podcast.update({
        where: { id: podcast.id },
        data: {
          ttsProvider: selected.ttsProvider,
          ttsModel: selected.ttsModel,
          aiModel: selected.aiModel,
        },
      });
    }

    // 13. Notify user if their requested model couldn't be used
    //     Try DM first (private, less noisy), fall back to polite reply
    if (modelWarning) {
      const dmSent = await sendDirectMessage(tweet.author_id, modelWarning);
      if (!dmSent) {
        try {
          await replyToTweet(
            tweet.id,
            `We'd love to use ${parsed.requestedAiModel || parsed.requestedTtsProvider} for you! To unlock premium models, add your API keys at ${SOTTO_APP_URL}/settings/api`
          );
        } catch (replyErr) {
          logger.warn('Failed to send model warning reply', {
            tweetId: tweet.id,
            error: replyErr instanceof Error ? replyErr.message : String(replyErr),
          });
        }
      }
    }

    logger.info('Twitter mention processed — podcast created', {
      tweetId: tweet.id,
      podcastId: podcast.id,
      topic: parsed.topic,
      isThread: String(!!isThreadPodcast),
      requestedAiModel: parsed.requestedAiModel ?? 'none',
      requestedTtsProvider: parsed.requestedTtsProvider ?? 'none',
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
      `Sign up at ${SOTTO_APP_URL} and get 3 free podcasts! Connect your Twitter account to generate podcasts directly from tweets.`
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

