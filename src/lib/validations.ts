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
  usePremiumVoice: z.boolean().default(false),
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
  sort: z.enum(['recent', 'popular', 'trending']).default('recent'),
  tags: z.string().optional(), // comma-separated tag slugs
  depth: z.enum(['quick_overview', 'standard', 'deep_dive']).optional(),
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
 * Billing checkout validation — subscription tier selection
 */
export const checkoutSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscription'),
    tier: z.enum(['starter', 'pro', 'studio']),
  }),
  z.object({
    type: z.literal('credit_pack'),
    credits: z.union([z.literal(3), z.literal(10), z.literal(25)]),
  }),
]);

/**
 * Analytics query validation
 */
export const analyticsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

/**
 * Team creation validation
 */
export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
});

/**
 * Team update validation
 */
export const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

/**
 * Team invite validation
 */
export const teamInviteSchema = z.object({
  email: z.string().email(),
});

/**
 * API key creation validation
 */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
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
 * Onboarding interests validation
 */
export const onboardingInterestsSchema = z.object({
  tagIds: z.array(z.string()).max(12),
});

/**
 * Inspire Me drill-down validation
 */
export const inspireDrillSchema = z.object({
  category: z.string().min(1).max(200),
  parentTitle: z.string().min(1).max(200).optional(),
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
