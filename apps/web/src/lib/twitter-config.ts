import { prisma } from './prisma';
import type { TwitterConfigData } from '@/types/twitter';

const DEFAULTS: TwitterConfigData = {
  autoTweetEnabled: false,
  minLikes: 10,
  minPlays: 50,
  minForks: 3,
  mentionPollIntervalMs: 60000,
  trendPollingEnabled: false,
  trendPollIntervalMs: 7200000,
  maxTrendPodcastsPerDay: 3,
  trendSearchQueries: ['AI', 'science', 'technology'],
  tweetTemplate: 'New on Sotto: {{title}}\n\n{{topic}}\n\nListen: {{url}}',
  defaultAiModel: null,
  defaultTtsProvider: null,
  defaultTtsModel: null,
};

/**
 * Get the current Twitter admin config.
 * Creates the singleton row with defaults if it doesn't exist.
 */
export async function getTwitterConfig(): Promise<TwitterConfigData> {
  const row = await prisma.twitterConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      autoTweetEnabled: DEFAULTS.autoTweetEnabled,
      minLikes: DEFAULTS.minLikes,
      minPlays: DEFAULTS.minPlays,
      minForks: DEFAULTS.minForks,
      mentionPollIntervalMs: DEFAULTS.mentionPollIntervalMs,
      trendPollingEnabled: DEFAULTS.trendPollingEnabled,
      trendPollIntervalMs: DEFAULTS.trendPollIntervalMs,
      maxTrendPodcastsPerDay: DEFAULTS.maxTrendPodcastsPerDay,
      trendSearchQueries: DEFAULTS.trendSearchQueries,
      tweetTemplate: DEFAULTS.tweetTemplate,
    },
  });

  return {
    autoTweetEnabled: row.autoTweetEnabled,
    minLikes: row.minLikes,
    minPlays: row.minPlays,
    minForks: row.minForks,
    mentionPollIntervalMs: row.mentionPollIntervalMs,
    trendPollingEnabled: row.trendPollingEnabled,
    trendPollIntervalMs: row.trendPollIntervalMs,
    maxTrendPodcastsPerDay: row.maxTrendPodcastsPerDay,
    trendSearchQueries: row.trendSearchQueries,
    tweetTemplate: row.tweetTemplate,
    defaultAiModel: row.defaultAiModel,
    defaultTtsProvider: row.defaultTtsProvider,
    defaultTtsModel: row.defaultTtsModel,
  };
}

/**
 * Update the Twitter admin config (admin only).
 */
export async function setTwitterConfig(
  data: Partial<TwitterConfigData>,
  adminId: string
): Promise<void> {
  await prisma.twitterConfig.upsert({
    where: { id: 'singleton' },
    update: {
      ...(data.autoTweetEnabled !== undefined && { autoTweetEnabled: data.autoTweetEnabled }),
      ...(data.minLikes !== undefined && { minLikes: data.minLikes }),
      ...(data.minPlays !== undefined && { minPlays: data.minPlays }),
      ...(data.minForks !== undefined && { minForks: data.minForks }),
      ...(data.mentionPollIntervalMs !== undefined && {
        mentionPollIntervalMs: data.mentionPollIntervalMs,
      }),
      ...(data.trendPollingEnabled !== undefined && {
        trendPollingEnabled: data.trendPollingEnabled,
      }),
      ...(data.trendPollIntervalMs !== undefined && {
        trendPollIntervalMs: data.trendPollIntervalMs,
      }),
      ...(data.maxTrendPodcastsPerDay !== undefined && {
        maxTrendPodcastsPerDay: data.maxTrendPodcastsPerDay,
      }),
      ...(data.trendSearchQueries !== undefined && {
        trendSearchQueries: data.trendSearchQueries,
      }),
      ...(data.tweetTemplate !== undefined && { tweetTemplate: data.tweetTemplate }),
      ...(data.defaultAiModel !== undefined && { defaultAiModel: data.defaultAiModel }),
      ...(data.defaultTtsProvider !== undefined && { defaultTtsProvider: data.defaultTtsProvider }),
      ...(data.defaultTtsModel !== undefined && { defaultTtsModel: data.defaultTtsModel }),
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      autoTweetEnabled: data.autoTweetEnabled ?? DEFAULTS.autoTweetEnabled,
      minLikes: data.minLikes ?? DEFAULTS.minLikes,
      minPlays: data.minPlays ?? DEFAULTS.minPlays,
      minForks: data.minForks ?? DEFAULTS.minForks,
      mentionPollIntervalMs: data.mentionPollIntervalMs ?? DEFAULTS.mentionPollIntervalMs,
      trendPollingEnabled: data.trendPollingEnabled ?? DEFAULTS.trendPollingEnabled,
      trendPollIntervalMs: data.trendPollIntervalMs ?? DEFAULTS.trendPollIntervalMs,
      maxTrendPodcastsPerDay: data.maxTrendPodcastsPerDay ?? DEFAULTS.maxTrendPodcastsPerDay,
      trendSearchQueries: data.trendSearchQueries ?? DEFAULTS.trendSearchQueries,
      tweetTemplate: data.tweetTemplate ?? DEFAULTS.tweetTemplate,
      defaultAiModel: data.defaultAiModel ?? DEFAULTS.defaultAiModel,
      defaultTtsProvider: data.defaultTtsProvider ?? DEFAULTS.defaultTtsProvider,
      defaultTtsModel: data.defaultTtsModel ?? DEFAULTS.defaultTtsModel,
      updatedBy: adminId,
    },
  });
}
