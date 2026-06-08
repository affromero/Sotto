import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getTweet, getThread } from '@/lib/twitter';
import { parseThreadIntent, parseTweetIntent } from '@/lib/tweet-parser';
import { getTwitterConfig } from '@/lib/twitter-config';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair } from '@/lib/elevenlabs';
import { lookupParticipantCredentials } from '@/lib/credential-lookup';
import { getAiKey } from '@/lib/byok';
import { getAiProviderMeta, getProviderForModel, type AiProviderId } from '@/lib/providers/ai-registry';
import { formatThreadAsSourceText, getVerifiedParticipants } from '@/lib/twitter-utils';
import { generatePodcastSlug } from '@/lib/slugify';
import { logger } from '@/lib/logger';
import { requireSystemUser } from '@/lib/system-user';
import type { AdminThreadToPodcastPayload } from '@/lib/queue';
import type { CredentialLookupAiOptions } from '@/lib/credential-lookup';

const TWEET_URL_REGEX = /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/;
const LOCAL_AI_PROVIDER: AiProviderId = 'claude-code';
const LOCAL_MODEL_PREFIX = 'claude-code:';

function providerForAdminCredentialModel(model: string): AiProviderId | null {
  if (model.startsWith(LOCAL_MODEL_PREFIX) && model.length > LOCAL_MODEL_PREFIX.length) {
    return LOCAL_AI_PROVIDER;
  }
  return getProviderForModel(model);
}

async function resolveAdminCredentialLookupAi(
  userId: string,
  model: string | null,
): Promise<CredentialLookupAiOptions> {
  if (model) {
    const provider = providerForAdminCredentialModel(model);
    if (!provider) {
      throw new Error(`Unknown AI model for participant credential lookup: ${model}`);
    }
    if (provider === LOCAL_AI_PROVIDER) {
      return { providerType: provider, model };
    }

    const providerKey = await getAiKey(userId, provider);
    if (!providerKey) {
      throw new Error(`AI key for provider "${provider}" is required for participant credential lookup.`);
    }
    return { providerType: provider, model, apiKeyOverride: providerKey.apiKey };
  }

  const userKey = await getAiKey(userId);
  if (!userKey) {
    throw new Error('AI key or explicit local AI model is required for participant credential lookup.');
  }
  const provider = userKey.provider;
  const defaultModel = getAiProviderMeta(provider).defaultModel;
  if (!defaultModel) {
    throw new Error(`No default AI model configured for provider "${provider}".`);
  }
  return { providerType: provider, model: defaultModel, apiKeyOverride: userKey.apiKey };
}

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
  const tweetResult = await getTweet(tweetId);
  if (!tweetResult) {
    throw new Error(`Tweet not found: ${tweetId}`);
  }
  const tweet = tweetResult.tweet;

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

  // 5. Resolve configured system owner and admin-configured model defaults for parsing
  const systemUser = await requireSystemUser(prisma);

  const twitterConfig = await getTwitterConfig();
  const parseOptions = {
    userId: systemUser.id,
    aiModel: twitterConfig.defaultAiModel ?? undefined,
  };

  // 6. Always parse thread/tweet for content first, then merge admin overrides
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
    ? await parseThreadIntent(mentionAsThreadTweet, threadData, parseOptions)
    : await parseTweetIntent(tweet.text, undefined, parseOptions);

  if (message) {
    const overrides = await parseTweetIntent(message, undefined, parseOptions);
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
      participantCredentials = await lookupParticipantCredentials(
        verifiedParticipants,
        await resolveAdminCredentialLookupAi(systemUser.id, twitterConfig.defaultAiModel)
      );
    }
  }

  await job.updateProgress(60);

  // 8. Create podcast owned by the configured system owner
  const voicePair = selectVoicePair(tweetId);

  const tone = parsed.isDebate ? 'socratic' : parsed.tone;
  const durationTarget = parsed.durationTarget ?? (isThreadPodcast ? 15 : 10);

  // Build source text for threads
  const sourceText = isThreadPodcast && threadData
    ? formatThreadAsSourceText(threadData, parsed, participantCredentials)
    : undefined;

  const slug = await generatePodcastSlug(parsed.title, systemUser.id, prisma);
  const podcast = await prisma.podcast.create({
    data: {
      userId: systemUser.id,
      title: parsed.title,
      topic: parsed.topic,
      slug,
      status: 'EXTRACTING',
      source: 'TWITTER',
      sourceTweetId: tweetId,
      aiModel: twitterConfig.defaultAiModel ?? undefined,
      ttsProvider: twitterConfig.defaultTtsProvider ?? undefined,
      ttsModel: twitterConfig.defaultTtsModel ?? undefined,
      aiAutoResolved: true,
      ttsAutoResolved: true,
      voices: {
        createMany: {
          data: [
            { speaker: 'HOST', voiceId: voicePair.host.id },
            { speaker: 'EXPERT', voiceId: voicePair.expert.id },
          ],
        },
      },
      visibility: 'PUBLIC',
      discovery: {
        create: {
          userId: systemUser.id,
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
    userId: systemUser.id,
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
