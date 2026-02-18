import { z } from 'zod';

/**
 * Discovery chat message validation
 */
export const discoveryMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  podcastId: z.string().optional(),
});

/**
 * Podcast creation validation
 */
export const createPodcastSchema = z.object({
  title: z.string().min(1).max(200),
  topic: z.string().min(1).max(5000),
  discoveryId: z.string().optional(),
  hostVoiceId: z.string().optional(),
  expertVoiceId: z.string().optional(),
  ttsProvider: z.enum(['elevenlabs', 'openai', 'playht', 'cartesia', 'hume', 'fal', 'replicate']).optional(),
  aiModel: z.string().optional(),
  ttsModel: z.string().optional(),
  metadata: z.object({
    topic: z.string(),
    depth: z.string().optional(),
    audienceLevel: z.string().optional(),
    audience: z.string().optional(),
    focusAreas: z.array(z.string()).optional(),
    tone: z.string().optional(),
    durationTarget: z.number().min(5).max(40).optional(),
    sourceUrl: z.string().url().optional(),
    sourceContent: z.string().optional(),
  }).optional(),
});

/**
 * Script turn update validation
 */
export const updateScriptSchema = z.object({
  turns: z.array(z.object({
    speaker: z.enum(['HOST', 'EXPERT']),
    text: z.string().min(1).max(10000),
    direction: z.string().optional(),
  })).min(2),
});

/**
 * Interaction (Q&A during playback) validation
 */
export const interactionSchema = z.object({
  question: z.string().min(1).max(2000),
  timestamp: z.number().min(0),
});

/**
 * Podcast update validation
 */
export const updatePodcastSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  topic: z.string().min(1).max(5000).optional(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional(),
  dismissSuggestion: z.boolean().optional(),
});

/**
 * User profile update validation
 */
export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
});

/**
 * Feed query validation
 */
export const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().max(200).optional(),
  tag: z.string().optional(),
  language: z.string().max(5).optional(),
  sort: z.enum(['recent', 'popular', 'trending', 'most_forked']).default('recent'),
  tags: z.string().optional(), // comma-separated tag slugs
  depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).optional(),
  audience: z.enum(['beginner', 'intermediate', 'expert']).optional(),
  tone: z.enum(['casual', 'professional', 'socratic']).optional(),
  durationMin: z.coerce.number().int().min(0).optional(),
  durationMax: z.coerce.number().int().min(0).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

/**
 * Pagination query validation
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});


/**
 * Analytics query validation
 */
export const analyticsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

/**
 * API key creation validation
 */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
});

/**
 * Voice browse query validation
 */
export const voiceBrowseQuerySchema = z.object({
  search: z.string().max(100).optional(),
  sort: z.enum(['newest', 'most_requested']).default('newest'),
  pricing: z.enum(['all', 'free', 'paid']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

/**
 * Voice price update validation
 */
export const voicePriceSchema = z.object({
  priceInCents: z.number().int().min(0).max(10000).nullable(), // $0-$100, null = free
});

/**
 * Voice clone creation validation
 */
export const cloneVoiceSchema = z.object({
  name: z.string().min(1).max(100),
  sourceType: z.enum(['UPLOAD', 'RECORD']),
});

/**
 * Voice preview validation
 */
export const voicePreviewSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).max(500),
});

/**
 * Waitlist signup validation
 */
export const waitlistSchema = z.object({
  email: z.string().email().max(200),
  source: z.string().max(50).optional(),
});

/**
 * Twitter settings validation
 */
export const twitterSettingsSchema = z.object({
  twitterEnabled: z.boolean().optional(),
  preferredHostVoiceId: z.string().nullable().optional(),
  preferredExpertVoiceId: z.string().nullable().optional(),
  preferredTtsProvider: z.string().nullable().optional(),
  preferredTtsModel: z.string().nullable().optional(),
  preferredAiProvider: z.string().nullable().optional(),
  preferredAiModel: z.string().nullable().optional(),
});

/**
 * Listening queue validation
 */
export const addToQueueSchema = z.object({
  podcastId: z.string(),
  source: z.enum(['picks', 'explore', 'following', 'search']).default('explore'),
});

export const reorderQueueSchema = z.object({
  podcastId: z.string(),
  newPosition: z.number().int().min(0),
});

/**
 * Custom tag input (for "Other" free-text sub-interests)
 */
export const customTagSchema = z.object({
  name: z
    .string()
    .min(2, 'Custom interest must be at least 2 characters')
    .max(60, 'Custom interest must be at most 60 characters')
    .transform((s) => s.trim()),
  parentSlug: z.string().min(1, 'Parent category is required'),
});

/**
 * Onboarding interests validation
 */
export const onboardingInterestsSchema = z.object({
  tagIds: z.array(z.string()).max(20),
  customTags: z.array(customTagSchema).max(10).default([]),
});

/**
 * Picks refresh validation
 */
export const refreshPicksSchema = z.object({
  refreshBatch: z.number().int().min(0).default(0),
});

/**
 * Handle validation
 */
export const handleSchema = z
  .string()
  .min(3, 'Handle must be at least 3 characters')
  .max(30, 'Handle must be at most 30 characters')
  .regex(/^[a-z0-9_]+$/, 'Handle can only contain lowercase letters, numbers, and underscores');

export const updateHandleSchema = z.object({
  handle: handleSchema,
});

export const reservedHandleSchema = z.object({
  handle: handleSchema,
  reason: z.string().max(200).optional(),
});

/**
 * Voice request validation
 */
export const createVoiceRequestSchema = z.object({
  voiceCloneId: z.string().min(1),
  message: z.string().max(500).optional(),
});

export const updateVoiceRequestSchema = z.object({
  status: z.enum(['APPROVED', 'DENIED', 'REVOKED']),
});

/**
 * Voice allowlist validation
 */
export const addToAllowlistSchema = z.object({
  voiceCloneId: z.string().min(1),
  handle: z.string().min(3).max(30),
});

/**
 * User search validation
 */
export const userSearchSchema = z.object({
  handle: z.string().min(2).max(30),
});

/**
 * BYOK API key validation (multi-provider)
 */
export const byokSchema = z.object({
  provider: z.enum(['elevenlabs', 'openai', 'playht', 'cartesia', 'hume', 'fal', 'replicate']),
  apiKey: z.string().min(10).max(500),
  userId: z.string().optional(), // PlayHT requires this
});

/**
 * Import podcast validation
 */
export const importPodcastSchema = z.object({
  title: z.string().max(200).optional(),
  topic: z.string().max(5000).optional(),
  isHumanContent: z.boolean().default(false),
  sourcePlatform: z.string().max(50).optional(),
  sttProvider: z.enum(['openai', 'elevenlabs', 'groq']).optional(),
});

/**
 * Fork body validation (optional remix parameters)
 */
export const forkBodySchema = z.object({
  topic: z.string().min(1).max(5000).optional(),
  remixNote: z.string().max(2000).optional(),
  focusAreas: z.array(z.string()).max(10).optional(),
  depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).optional(),
  tone: z.enum(['casual', 'professional', 'socratic']).optional(),
});

/**
 * Resolve interaction validation (helpful feedback)
 */
export const resolveInteractionSchema = z.object({
  helpful: z.boolean(),
});

/**
 * Comment creation validation
 */
export const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().optional(),
  timestamp: z.number().min(0).optional(),
});

/**
 * Collection creation validation
 */
export const createCollectionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

/**
 * Collection update validation
 */
export const updateCollectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

/**
 * Collection item validation (add/remove podcast)
 */
export const collectionItemSchema = z.object({
  podcastId: z.string().min(1),
});

/**
 * Account deletion confirmation
 */
export const deleteAccountSchema = z.object({
  confirm: z.literal('DELETE'),
});

/**
 * Telegram account linking validation
 */
export const telegramConnectSchema = z.object({
  code: z.string().min(1),
});

/**
 * User discovery search validation
 */
export const userDiscoverySearchSchema = z.object({
  query: z.string().min(2).max(100),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

/**
 * Saved idea validation
 */
export const savedIdeaSchema = z.object({
  questionId: z.string().min(1).max(20),
  question: z.string().min(1).max(500),
  tagSlugs: z.array(z.string().min(1).max(100)).min(1).max(3),
  category: z.string().min(1).max(100),
});

/**
 * Taste quiz question request validation
 */
export const tasteQuizQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(20).default(10),
});

/**
 * Taste quiz answer submission validation
 */
export const tasteQuizAnswerSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().min(1).max(20),
    question: z.string().min(1).max(500),
    tagSlugs: z.array(z.string().min(1).max(100)).min(1).max(3),
    response: z.enum(['yes', 'no', 'skip']),
  })).min(1).max(20),
});

/**
 * Podcast rating validation
 */
export const podcastRatingSchema = z.object({
  voiceNaturalness: z.number().int().min(1).max(5),
  contentAccuracy: z.number().int().min(1).max(5),
  conversationFlow: z.number().int().min(1).max(5),
  overallSatisfaction: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

/**
 * Report creation validation
 */
export const createReportSchema = z.object({
  targetType: z.enum(['podcast', 'comment', 'user']),
  targetId: z.string().min(1),
  reason: z.enum([
    'HARASSMENT',
    'HATE_SPEECH',
    'VIOLENCE',
    'SEXUAL_CONTENT',
    'MISINFORMATION',
    'SPAM',
    'IMPERSONATION',
    'COPYRIGHT',
    'OTHER',
  ]),
  description: z.string().max(2000).optional(),
});

/**
 * Report resolution validation (admin)
 */
export const resolveReportSchema = z.object({
  status: z.enum(['RESOLVED_ACTIONED', 'RESOLVED_DISMISSED']),
  resolution: z.string().max(2000).optional(),
});

/**
 * Admin user moderation validation
 */
export const moderateUserSchema = z.object({
  action: z.enum(['warn', 'suspend', 'ban', 'unban', 'unsuspend']),
  reason: z.string().min(1).max(2000),
  durationDays: z.number().int().min(1).max(365).optional(),
});

/**
 * Twitter config update validation (admin)
 */
export const twitterConfigUpdateSchema = z.object({
  autoTweetEnabled: z.boolean().optional(),
  minLikes: z.number().int().min(1).max(10000).optional(),
  minPlays: z.number().int().min(1).max(100000).optional(),
  minForks: z.number().int().min(1).max(1000).optional(),
  trendPollingEnabled: z.boolean().optional(),
  trendPollIntervalMs: z.number().int().min(300000).max(86400000).optional(),
  maxTrendPodcastsPerDay: z.number().int().min(1).max(20).optional(),
  trendSearchQueries: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
  tweetTemplate: z.string().min(10).max(500).optional(),
});

/**
 * Manual tweet validation (admin)
 */
export const manualTweetSchema = z.object({
  podcastId: z.string().min(1),
});

/**
 * Thread-to-podcast validation (admin)
 */
export const threadToPodcastSchema = z.object({
  tweetUrl: z.string().url().regex(/(?:twitter\.com|x\.com)\/\w+\/status\/\d+/),
  message: z.string().max(1000).optional(),
});

/**
 * Trend generate validation (admin)
 */
export const trendGenerateSchema = z.object({
  tweetText: z.string().min(1).max(5000),
  tweetId: z.string().optional(),
});
