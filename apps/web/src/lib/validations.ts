import { z } from 'zod';

/**
 * Demo podcast creation validation (admin showcase — legacy, kept for old API)
 */
export const createDemoSchema = z.object({
  topic: z.string().min(1).max(500),
  title: z.string().max(200).optional(),
  featureFocus: z.array(z.string()).max(10).optional(),
  durationTarget: z.number().min(1).max(3).default(2),
  speakers: z.array(z.object({ name: z.string(), description: z.string() })).max(4).optional(),
  aiModel: z.string().optional(),
});

/**
 * Demo Video Studio — DemoProject creation
 */
export const createDemoProjectSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  features: z.array(z.string()).max(10).default([]),
  durationTarget: z.number().min(30).max(300).default(120),
  aiModel: z.string().max(100).optional(),
  defaultTtsProvider: z.string().max(50).optional(),
  defaultTtsModel: z.string().max(100).optional(),
  defaultTtsVoiceId: z.string().max(200).optional(),
  showcaseProviders: z.array(z.string().max(50)).max(10).optional(),
  scriptJson: z.unknown().optional(), // LaunchVideoScript — validated separately via launchVideoScriptSchema
});

export const updateDemoProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  features: z.array(z.string()).max(10).optional(),
  backgroundMusicUrl: z.string().url().nullable().optional(),
  backgroundMusicVolume: z.number().min(0).max(1).optional(),
  avatarClipUrl: z.string().url().nullable().optional(),
  podcastId: z.string().nullable().optional(),
});

/**
 * DemoAction Zod schema — discriminated union matching the DemoAction type
 */
export const demoActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string() }),
  z.object({ type: z.literal('click'), selector: z.string() }),
  z.object({ type: z.literal('type'), selector: z.string(), text: z.string(), speed: z.object({ min: z.number(), max: z.number() }).optional() }),
  z.object({ type: z.literal('wait'), ms: z.number() }),
  z.object({ type: z.literal('scroll'), distance: z.number(), duration: z.number().optional() }),
  z.object({ type: z.literal('zoom'), selector: z.string(), scale: z.number().optional(), duration: z.number().optional() }),
  z.object({ type: z.literal('zoomReset'), duration: z.number().optional() }),
  z.object({ type: z.literal('hover'), selector: z.string() }),
  z.object({ type: z.literal('waitForSelector'), selector: z.string(), timeout: z.number().optional() }),
  z.object({ type: z.literal('intercept'), name: z.string(), options: z.record(z.unknown()) }),
  z.object({ type: z.literal('clearIntercept'), name: z.string() }),
  z.object({ type: z.literal('keypress'), key: z.string() }),
  z.object({ type: z.literal('screenshot'), label: z.string().optional() }),
]);

/**
 * Timing segment — speed zone within a recording
 */
export const timingSegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  speed: z.number().min(0).max(16), // 0 = skip, max 16x
}).refine((s) => s.end > s.start, { message: 'end must be greater than start' });

const timingSegmentsArraySchema = z.array(timingSegmentSchema).refine(
  (segs) => {
    for (let i = 1; i < segs.length; i++) {
      if (Math.abs(segs[i].start - segs[i - 1].end) > 0.01) return false;
    }
    return true;
  },
  { message: 'Timing segments must be contiguous (no gaps or overlaps)' },
);

/**
 * Demo Video Studio — DemoScene update
 */
export const updateDemoSceneSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  narration: z.string().optional(),
  actions: z.array(demoActionSchema).optional(),
  visualPrompt: z.string().optional(),
  visualType: z.enum(['ai_image', 'ai_video', 'map']).nullable().optional(),
  ttsProvider: z.string().optional(),
  ttsModel: z.string().optional(),
  ttsVoiceId: z.string().optional(),
  transitionType: z.enum(['fade', 'dissolve', 'wipe']).nullable().optional(),
  timingSegments: timingSegmentsArraySchema.nullable().optional(),
  // Launch video cinematic fields
  sfxConfig: z.record(z.unknown()).nullable().optional(),
  providerBanner: z.record(z.unknown()).nullable().optional(),
  avatarConfig: z.record(z.unknown()).nullable().optional(),
  overlays: z.array(z.record(z.unknown())).nullable().optional(),
  subtitles: z.record(z.unknown()).nullable().optional(),
});

/**
 * Voice track validation schemas
 */
export const createVoiceTrackSchema = z.object({
  ttsProvider: z.string().optional(),
  ttsModel: z.string().optional(),
  voices: z.array(z.object({
    speaker: z.string(),
    voiceId: z.string(),
    provider: z.string().optional(),
  })).min(1),
  paymentIntentIds: z.array(z.string()).optional(),
  skipPaidVoices: z.boolean().optional(),
});

export const updateVoiceTrackSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export const setDefaultTrackSchema = z.object({
  voiceTrackId: z.string().nullable(),
});

export const voiceForkBodySchema = z.object({
  name: z.string().min(1).max(100),
  ttsProvider: z.string().optional(),
  ttsModel: z.string().optional(),
  voices: z.array(z.object({
    speaker: z.string(),
    voiceId: z.string(),
    provider: z.string().optional(),
  })).min(1),
  paymentIntentIds: z.array(z.string()).optional(),
  skipPaidVoices: z.boolean().optional(),
});

/**
 * Discovery chat message validation
 */
export const discoveryMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  podcastId: z.string().optional(),
});

/**
 * Podcast creation validation — canonical schema lives in @sotto/shared
 */
export { createPodcastSchema } from '@sotto/shared';

/**
 * Script turn update validation
 */
export const updateScriptSchema = z.object({
  turns: z.array(z.object({
    speaker: z.string().min(1).max(50),
    text: z.string().min(1).max(10000),
    direction: z.string().optional(),
  })).min(1),
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
  sourceType: z.enum(['UPLOAD', 'RECORD', 'IMPORT']),
});

export const importVoiceSchema = z.object({
  name: z.string().min(1).max(100),
  externalVoiceId: z.string().min(1).max(200),
  provider: z.literal('hume'),
});

export const voiceVerifyChallengeSchema = z.object({
  voiceCloneId: z.string().min(1),
});

/**
 * Voice preview validation
 */
export const voicePreviewSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).max(500),
  provider: z.enum(['elevenlabs', 'hume', 'cartesia', 'openai']).optional(),
});

/**
 * Waitlist signup validation
 */
export const waitlistSchema = z.object({
  email: z.string().email().max(200),
  twitterHandle: z.string().max(50).optional()
    .transform(val => val ? val.replace(/^@/, '').trim() : undefined),
  source: z.string().max(50).optional(),
  wishlist: z.string().max(500).optional(),
  referralCode: z.string().max(50).optional()
    .transform(val => val ? val.replace(/^@/, '').trim().toLowerCase() : undefined),
});

/**
 * Admin waitlist action validation (approve/reject)
 */
export const adminWaitlistActionSchema = z.object({
  id: z.string(),
  status: z.enum(['APPROVED', 'REJECTED']),
});

export const adminWaitlistDeleteSchema = z.object({
  id: z.string(),
});

/**
 * Twitter settings validation
 */
export const twitterSettingsSchema = z.object({
  twitterEnabled: z.boolean().optional(),
  voicePreferences: z.array(z.object({
    speaker: z.string().min(1).max(50),
    voiceId: z.string().min(1),
  })).optional(),
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
  provider: z.enum(['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate']),
  apiKey: z.string().min(10).max(500),
});

/**
 * Draft creation validation
 */
const draftMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(50000),
  chips: z.array(z.string()).optional(),
});

const draftMetadataSchema = z.object({
  topic: z.string().optional(),
  depth: z.string().optional(),
  audienceLevel: z.string().optional(),
  audience: z.string().optional(),
  focusAreas: z.array(z.string()).optional(),
  tone: z.string().optional(),
  durationTarget: z.number().min(1).max(40).optional(),
  ready: z.boolean().optional(),
});

export const createDraftSchema = z.object({
  tabMode: z.enum(['create', 'import']),
  messages: z.array(draftMessageSchema).optional(),
  metadata: draftMetadataSchema.optional(),
  importData: z.object({
    title: z.string().max(200).optional(),
    topic: z.string().max(5000).optional(),
    sourcePlatform: z.string().max(50).optional(),
    isHumanContent: z.boolean().optional(),
    sttProvider: z.string().optional(),
  }).optional(),
});

export const updateDraftSchema = z.object({
  draftData: z.record(z.unknown()).optional(),
  metadata: draftMetadataSchema.optional(),
});

export const appendDraftMessagesSchema = z.object({
  messages: z.array(draftMessageSchema).min(1),
  metadata: draftMetadataSchema.optional(),
});

/**
 * Import podcast validation
 */
export const importPodcastSchema = z.object({
  title: z.string().max(200).optional(),
  topic: z.string().max(5000).optional(),
  isHumanContent: z.boolean().default(false),
  sourcePlatform: z.string().min(1).max(50),
  sttProvider: z.enum(['openai', 'elevenlabs', 'together', 'deepgram', 'assemblyai']).optional(),
  sttModel: z.string().max(100).optional(),
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
  completionPercent: z.number().min(0).max(100).optional(),
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
    'VOICE_THEFT',
    'MUSIC_UPLOAD',
    'FALSE_HUMAN_BADGE',
    'FALSE_CLAIM',
    'OTHER',
  ]),
  description: z.string().max(2000).optional(),
});

/**
 * Admin badge update validation
 */
export const adminUpdateBadgeSchema = z.object({
  isHumanContent: z.boolean(),
  reason: z.string().min(1).max(2000),
});

/**
 * Report resolution validation (admin)
 */
export const resolveReportSchema = z.object({
  status: z.enum(['RESOLVED_ACTIONED', 'RESOLVED_DISMISSED', 'ASSET_REPLACED', 'DELISTED']),
  resolution: z.string().max(2000).optional(),
});

export const copyrightClaimSchema = z.object({
  claimantEmail: z.string().email().max(320),
  claimantName: z.string().min(1).max(200),
  description: z.string().min(10).max(5000),
  evidenceUrl: z.string().url().max(2000).optional(),
  segmentVisualId: z.string().min(1).optional(),
});

export const copyrightCounterNoticeSchema = z.object({
  counterNotice: z.string().min(10).max(5000),
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
  defaultAiModel: z.string().max(100).nullable().optional(),
  defaultTtsProvider: z.string().max(100).nullable().optional(),
  defaultTtsModel: z.string().max(100).nullable().optional(),
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
 * Referral attribution validation
 */
export const referralSchema = z.object({
  handle: z.string().min(3).max(30),
});

/**
 * Mentions list validation (admin GET)
 */
export const mentionsQuerySchema = z.object({
  status: z.enum(['PENDING', 'PARSING', 'GENERATING', 'READY', 'REPLIED', 'FAILED', 'IGNORED']).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Trend filter validation (admin GET)
 */
export const trendFilterSchema = z.object({
  lang: z.string().min(2).max(5).optional(),
  verified: z.coerce.boolean().optional(),
  minEngagement: z.coerce.number().int().min(0).optional(),
  maxPerQuery: z.coerce.number().int().min(10).max(100).optional(),
});

/**
 * Trend generate validation (admin POST)
 */
export const trendGenerateSchema = z.object({
  tweetText: z.string().min(1).max(5000),
  tweetId: z.string().optional(),
});

/**
 * Claim report creation validation
 */
export const createClaimReportSchema = z.object({
  turnIndex: z.number().int().min(0),
  turnText: z.string().min(1).max(10000),
  description: z.string().min(10, 'Please describe the issue (at least 10 characters)').max(2000),
});

/**
 * Claim report resolution validation (admin)
 */
export const resolveClaimReportSchema = z.object({
  status: z.enum(['RESOLVED_VERIFIED', 'RESOLVED_INACCURATE', 'DISMISSED']),
  resolution: z.string().max(2000).optional(),
});

/**
 * Script regeneration with optional user feedback
 */
export const regenerateWithFeedbackSchema = z.object({
  feedback: z.string().max(5000).optional(),
  turnComments: z.record(z.coerce.number(), z.string().max(2000)).optional(),
  highlights: z.array(z.object({
    turnIndex: z.number().int().min(0),
    text: z.string().max(500),
    note: z.string().max(2000),
  })).max(50).optional(),
}).optional();

/**
 * Video generation request validation
 */
const pipelineSubVisualSchema = z.object({
  subOrder: z.number().int().min(0),
  startOffset: z.number().min(0),
  duration: z.number().positive(),
  visualType: z.string(),
  visualMode: z.enum(['image', 'video', 'programmatic']),
  model: z.string().nullable(),
  prompt: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  endStatePrompt: z.string().nullable().optional(),
});

export const pipelineTransitionSchema = z.object({
  fromSegmentOrder: z.number().int(),
  toSegmentOrder: z.number().int(),
  fromSegmentId: z.string(),
  toSegmentId: z.string(),
  enabled: z.boolean(),
  recommended: z.boolean().optional().default(false),
  recommendationReason: z.string().optional(),
  transitionModel: z.string().nullable(),
  durationSeconds: z.number().min(0.5).max(3).default(1),
  estimatedCost: z.number().optional().default(0),
});

export const generateVideoSchema = z
  .object({
    imageModel: z.string().optional(),
    pipeline: z
      .object({
        version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        defaultImageModel: z.string(),
        defaultVideoModel: z.string(),
        segments: z.array(
          z.object({
            segmentId: z.string(),
            order: z.number(),
            visualType: z.string(),
            visualMode: z.enum(['image', 'video', 'programmatic']),
            model: z.string().nullable(),
            prompt: z.string().nullable(),
            metadata: z.record(z.unknown()).nullable(),
            endStatePrompt: z.string().nullable().optional(),
            subVisuals: z.array(pipelineSubVisualSchema).optional(),
          }),
        ),
        transitions: z.array(pipelineTransitionSchema).optional(),
        defaultTransitionModel: z.string().optional(),
      })
      .optional(),
  })
  .optional();

/**
 * Video segment update validation — selective regeneration via PATCH
 */
export const updateVideoSegmentsSchema = z.object({
  segments: z.array(
    z.object({
      segmentVisualId: z.string(),
      visualType: z.string().optional(),
      visualMode: z.enum(['image', 'video', 'programmatic']).optional(),
      model: z.string().nullable().optional(),
      prompt: z.string().nullable().optional(),
      metadata: z.record(z.unknown()).nullable().optional(),
      endStatePrompt: z.string().nullable().optional(),
    }),
  ).min(1),
});

/**
 * AI-generated script validation — applied after JSON parse in script-generator
 */
export const generatedScriptSchema = z.object({
  turns: z.array(z.object({
    speaker: z.string().min(1).max(50),
    text: z.string().min(1),
    direction: z.string().optional(),
  })).min(1),
  soundCues: z.array(z.object({
    type: z.enum(['intro', 'transition', 'outro', 'ambient']),
    prompt: z.string().min(1),
    durationSeconds: z.number().positive(),
    insertAfterTurn: z.number().int(),
  })).catch([]),
  references: z.preprocess(
    (val) => {
      if (!Array.isArray(val)) return [];
      const itemSchema = z.object({
        number: z.number().int().positive(),
        title: z.string().min(1),
        authors: z.union([z.array(z.string()), z.string()]),
        year: z.number().nullish(),
        url: z.string().nullish(),
        type: z.enum(['WEB', 'PAPER', 'BOOK', 'ARTICLE', 'VIDEO', 'REPORT']),
        publisher: z.string().nullish(),
        doi: z.string().nullish(),
      });
      // Filter invalid items individually instead of dropping the entire array
      return val.filter((item) => itemSchema.safeParse(item).success);
    },
    z.array(z.object({
      number: z.number().int().positive(),
      title: z.string().min(1),
      authors: z.union([z.array(z.string()), z.string()]),
      year: z.number().nullish(),
      url: z.string().nullish(),
      type: z.enum(['WEB', 'PAPER', 'BOOK', 'ARTICLE', 'VIDEO', 'REPORT']),
      publisher: z.string().nullish(),
      doi: z.string().nullish(),
    })),
  ),
  places: z.array(z.object({
    name: z.string().min(1),
    modernName: z.string().nullish(),
    coordinates: z.tuple([z.number(), z.number()]).nullish(),
    yearHint: z.number().int().nullish(),
    significance: z.string().nullish(),
  })).catch([]),
});

/**
 * Invitation link toggle validation (admin)
 */
export const toggleInvitationSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
});

/**
 * Invitation link redemption validation (public)
 */
export const redeemInvitationSchema = z.object({
  code: z.string().min(1).max(50),
  email: z.string().email().max(200),
});

export const configureAvatarsSchema = z.object({
  avatars: z.array(z.object({
    speaker: z.string().min(1).max(50),
    avatarId: z.string().min(1),
    avatarProvider: z.enum(['heygen', 'runway']).optional(),
    isPreset: z.boolean().optional(),
    enabledSegmentIds: z.array(z.string()).optional(),
  })).min(1).max(4),
});

export const updateAvatarPositionsSchema = z.object({
  positions: z.array(z.object({
    speaker: z.string().min(1),
    posX: z.number().min(0).max(1).optional(),
    posY: z.number().min(0).max(1).optional(),
    width: z.number().min(0.05).max(0.8).optional(),
    height: z.number().min(0.05).max(0.8).optional(),
    maskShape: z.enum(['none', 'rounded', 'circle', 'hexagon', 'diamond', 'blob', 'squircle']).optional(),
  })),
});

/**
 * Music generation
 */
export const generateMusicSchema = z.object({
  model: z.string().max(100).optional(),
});

export const updateMusicVolumeSchema = z.object({
  volume: z.number().min(0).max(1),
});
