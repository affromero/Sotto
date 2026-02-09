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
 * Billing checkout validation
 */
export const checkoutSchema = z.object({
  tier: z.enum(['pro', 'creator']),
});

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
