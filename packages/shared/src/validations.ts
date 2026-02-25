import { z } from 'zod';

// Shared validations used by both web and mobile clients

export const createPodcastSchema = z.object({
  title: z.string().min(1).max(200),
  topic: z.string().min(1).max(5000),
  discoveryId: z.string().optional(),
  voices: z.array(z.object({
    speaker: z.string().min(1).max(50),
    voiceId: z.string().optional(),
  })).optional(),
  ttsProvider: z.enum(['elevenlabs', 'openai', 'playht', 'cartesia', 'hume', 'fal', 'replicate']).optional(),
  aiModel: z.string().optional(),
  ttsModel: z.string().optional(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional(),
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
    speakers: z.array(z.object({
      name: z.string().min(1).max(50),
      description: z.string().min(1).max(500),
    })).max(4).optional(),
  }).optional(),
});

export const interactionSchema = z.object({
  question: z.string().min(1).max(2000),
  timestamp: z.number().min(0),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
});

export const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().max(200).optional(),
  tag: z.string().optional(),
  sort: z.enum(['recent', 'popular', 'trending', 'most_forked']).default('recent'),
  tags: z.string().optional(),
  depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).optional(),
  audience: z.enum(['beginner', 'intermediate', 'expert']).optional(),
  tone: z.enum(['casual', 'professional', 'socratic']).optional(),
  durationMin: z.coerce.number().int().min(0).optional(),
  durationMax: z.coerce.number().int().min(0).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const handleSchema = z
  .string()
  .min(3, 'Handle must be at least 3 characters')
  .max(30, 'Handle must be at most 30 characters')
  .regex(/^[a-z0-9_]+$/, 'Handle can only contain lowercase letters, numbers, and underscores');

export const discoveryMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  podcastId: z.string().optional(),
});
