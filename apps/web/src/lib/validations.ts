import { z } from 'zod';

/**
 * Demo podcast creation validation (admin showcase — legacy, kept for old API)
 */
export const createDemoSchema = z.object({
  topic: z.string().min(1).max(500),
  title: z.string().max(200).optional(),
  featureFocus: z.array(z.string()).max(10).optional(),
  durationTarget: z.number().min(1).max(3).default(2),
  speakers: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .max(4)
    .optional(),
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
  z.object({
    type: z.literal('type'),
    selector: z.string(),
    text: z.string(),
    speed: z.object({ min: z.number(), max: z.number() }).optional(),
  }),
  z.object({ type: z.literal('wait'), ms: z.number() }),
  z.object({ type: z.literal('scroll'), distance: z.number(), duration: z.number().optional() }),
  z.object({
    type: z.literal('zoom'),
    selector: z.string(),
    scale: z.number().optional(),
    duration: z.number().optional(),
  }),
  z.object({ type: z.literal('zoomReset'), duration: z.number().optional() }),
  z.object({ type: z.literal('hover'), selector: z.string() }),
  z.object({
    type: z.literal('waitForSelector'),
    selector: z.string(),
    timeout: z.number().optional(),
  }),
  z.object({ type: z.literal('intercept'), name: z.string(), options: z.record(z.unknown()) }),
  z.object({ type: z.literal('clearIntercept'), name: z.string() }),
  z.object({ type: z.literal('keypress'), key: z.string() }),
  z.object({ type: z.literal('screenshot'), label: z.string().optional() }),
]);

/**
 * Timing segment — speed zone within a recording
 */
export const timingSegmentSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    speed: z.number().min(0).max(16), // 0 = skip, max 16x
  })
  .refine((s) => s.end > s.start, { message: 'end must be greater than start' });

const timingSegmentsArraySchema = z.array(timingSegmentSchema).refine(
  (segs) => {
    for (let i = 1; i < segs.length; i++) {
      if (Math.abs(segs[i].start - segs[i - 1].end) > 0.01) return false;
    }
    return true;
  },
  { message: 'Timing segments must be contiguous (no gaps or overlaps)' }
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
  ttsProvider: z.string().nullable().optional(),
  ttsModel: z.string().nullable().optional(),
  ttsVoiceId: z.string().nullable().optional(),
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

const explicitTtsProviderSchema = z.enum([
  'elevenlabs',
  'openai',
  'cartesia',
  'hume',
  'fal',
  'replicate',
  'minimax',
  'mistral',
]);

const agentProviderSchema = z.enum(['claude-code', 'codex', 'openclaw', 'hermes', 'custom']);

/**
 * Private agent-output ingestion. This is intentionally separate from generic
 * podcast creation so local agents can post source material without exposing a
 * social or public sharing surface.
 */
export const agentIngestionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    topic: z.string().trim().min(1).max(5000).optional(),
    content: z.string().trim().min(1).max(120000),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    sourceUrl: z.string().url().optional(),
    durationTarget: z.number().int().min(1).max(40).optional(),
    depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).optional(),
    audienceLevel: z.enum(['beginner', 'intermediate', 'expert', 'general']).optional(),
    tone: z.string().trim().min(1).max(80).optional(),
    focusAreas: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    agent: z
      .object({
        provider: agentProviderSchema,
        name: z.string().trim().min(1).max(80),
        model: z.string().trim().min(1).max(120).optional(),
        runId: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    aiModel: z.string().trim().min(1).max(160).optional(),
    ttsProvider: explicitTtsProviderSchema,
    ttsModel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/**
 * Script turn update validation
 */
export const updateScriptSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.string().min(1).max(50),
        text: z.string().min(1).max(10000),
        direction: z.string().optional(),
      })
    )
    .min(1),
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
export const updatePodcastSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    topic: z.string().min(1).max(5000).optional(),
    visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional(),
    dismissSuggestion: z.boolean().optional(),
  })
  .strict();

/**
 * User profile update validation
 */
export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
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
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
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

export const importElevenLabsVoiceSchema = z.object({
  externalVoiceId: z.string().min(1).max(200),
  provider: z.literal('elevenlabs'),
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
  provider: z
    .enum(['elevenlabs', 'hume', 'cartesia', 'openai', 'fal', 'replicate', 'minimax', 'mistral', 'kokoro'])
    .refine((value) => value.length > 0),
});

/**
 * Waitlist signup validation
 */
export const waitlistSchema = z.object({
  email: z.string().email().max(200),
  twitterHandle: z
    .string()
    .max(50)
    .optional()
    .transform((val) => (val ? val.replace(/^@/, '').trim() : undefined)),
  source: z.string().max(50).optional(),
  wishlist: z.string().max(500).optional(),
  referralCode: z
    .string()
    .max(50)
    .optional()
    .transform((val) => (val ? val.replace(/^@/, '').trim().toLowerCase() : undefined)),
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
 * Explicit user handle lookup validation
 */
export const userSearchSchema = z.object({
  handle: handleSchema,
});

/**
 * BYOK API key validation (multi-provider)
 */
export const byokSchema = z.object({
  provider: z.enum([
    'elevenlabs',
    'openai',
    'cartesia',
    'hume',
    'fal',
    'replicate',
    'minimax',
    'mistral',
    'kokoro',
    'suno',
  ]),
  apiKey: z.string().min(10).max(500),
});

export const byokProviderSchema = byokSchema.pick({ provider: true });

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
  importData: z
    .object({
      title: z.string().max(200).optional(),
      topic: z.string().max(5000).optional(),
      sourcePlatform: z.string().max(50).optional(),
      isHumanContent: z.boolean().optional(),
      sttProvider: z.string().optional(),
    })
    .optional(),
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
 * Resolve interaction validation (helpful feedback)
 */
export const resolveInteractionSchema = z.object({
  helpful: z.boolean(),
});

/**
 * Account deletion confirmation
 */
export const deleteAccountSchema = z.object({
  confirm: z.literal('DELETE'),
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
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(20),
        question: z.string().min(1).max(500),
        tagSlugs: z.array(z.string().min(1).max(100)).min(1).max(3),
        response: z.enum(['yes', 'no', 'skip']),
      })
    )
    .min(1)
    .max(20),
});

/**
 * Report creation validation
 */
export const createReportSchema = z.object({
  targetType: z.enum(['podcast', 'user']),
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

/**
 * Admin user moderation validation
 */
export const moderateUserSchema = z.object({
  action: z.enum(['warn', 'suspend', 'ban', 'unban', 'unsuspend']),
  reason: z.string().min(1).max(2000),
  durationDays: z.number().int().min(1).max(365).optional(),
});

/**
 * Landing showcase config update validation (admin)
 */
export const landingShowcaseUpdateSchema = z
  .object({
    podcastId: z.string().min(1),
    scriptTurnStart: z.number().int().min(0).optional(),
    scriptTurnCount: z.number().int().min(1).max(10).optional(),
    audioClipStart: z.number().min(0).optional(),
    audioClipEnd: z.number().min(0).nullable().optional(),
    videoSegmentStart: z.number().int().min(0).optional(),
    videoSegmentCount: z.number().int().min(1).max(50).optional(),
    showAvatar: z.boolean().optional(),
    showVideo: z.boolean().optional(),
    twitterHandle: z.string().min(1).max(50).optional(),
    twitterName: z.string().min(1).max(100).optional(),
    telegramTopic: z.string().max(200).nullable().optional(),
  })
  .strict();

/**
 * Referral attribution validation
 */
export const referralSchema = z.object({
  handle: z.string().min(3).max(30),
});

/**
 * Script regeneration with optional user feedback
 */
export const regenerateWithFeedbackSchema = z
  .object({
    feedback: z.string().max(5000).optional(),
    turnComments: z.record(z.coerce.number(), z.string().max(2000)).optional(),
    highlights: z
      .array(
        z.object({
          turnIndex: z.number().int().min(0),
          text: z.string().max(500),
          note: z.string().max(2000),
        })
      )
      .max(50)
      .optional(),
    sourceUrls: z.array(z.string().url()).max(5).optional(),
  })
  .optional();

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
          })
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
  segments: z
    .array(
      z.object({
        segmentVisualId: z.string(),
        visualType: z.string().optional(),
        visualMode: z.enum(['image', 'video', 'programmatic']).optional(),
        model: z.string().nullable().optional(),
        prompt: z.string().nullable().optional(),
        metadata: z.record(z.unknown()).nullable().optional(),
        endStatePrompt: z.string().nullable().optional(),
        feedback: z.string().optional(),
      })
    )
    .min(1),
});

/**
 * AI-generated script validation — applied after JSON parse in script-generator
 */
export const generatedScriptSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.string().min(1).max(50),
        text: z.string().min(1),
        direction: z.string().optional(),
      })
    )
    .min(1),
  soundCues: z
    .array(
      z.object({
        type: z.enum([
          'intro',
          'transition',
          'outro',
          'ambient',
          'laugh_track',
          'music_sting',
          'applause',
          'comedic_hit',
          'rim_shot',
        ]),
        prompt: z.string().min(1),
        durationSeconds: z.number().positive(),
        insertAfterTurn: z.number().int(),
        volume: z.number().min(0).max(1).optional(),
        fadeOutMs: z.number().int().min(0).max(10000).optional(),
      })
    )
    .catch([]),
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
    z.array(
      z.object({
        number: z.number().int().positive(),
        title: z.string().min(1),
        authors: z.union([z.array(z.string()), z.string()]),
        year: z.number().nullish(),
        url: z.string().nullish(),
        type: z.enum(['WEB', 'PAPER', 'BOOK', 'ARTICLE', 'VIDEO', 'REPORT']),
        publisher: z.string().nullish(),
        doi: z.string().nullish(),
      })
    )
  ),
  places: z
    .array(
      z.object({
        name: z.string().min(1),
        modernName: z.string().nullish(),
        coordinates: z.tuple([z.number(), z.number()]).nullish(),
        yearHint: z.number().int().nullish(),
        significance: z.string().nullish(),
      })
    )
    .catch([]),
  vocabulary: z
    .array(
      z.object({
        number: z.number().int().positive(),
        word: z.string().min(1),
        translation: z.string().min(1),
        partOfSpeech: z.string().nullish(),
        pronunciation: z.string().nullish(),
        exampleSentence: z.string().nullish(),
        difficulty: z.string().nullish(),
      })
    )
    .catch([]),
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
  avatars: z
    .array(
      z.object({
        speaker: z.string().min(1).max(50),
        avatarId: z.string().min(1).optional(),
        avatarProvider: z.enum(['heygen', 'runway', 'fal']).optional(),
        avatarImageUrl: z.string().url().optional(),
        avatarModelId: z.string().optional(),
        isPreset: z.boolean().optional(),
        enabledSegmentIds: z.array(z.string()).optional(),
      })
    )
    .min(1)
    .max(4),
});

export const updateAvatarPositionsSchema = z.object({
  positions: z.array(
    z.object({
      speaker: z.string().min(1),
      posX: z.number().min(0).max(1).optional(),
      posY: z.number().min(0).max(1).optional(),
      width: z.number().min(0.05).max(0.8).optional(),
      height: z.number().min(0.05).max(0.8).optional(),
      maskShape: z
        .enum(['none', 'rounded', 'circle', 'hexagon', 'diamond', 'blob', 'squircle'])
        .optional(),
    })
  ),
});

export const avatarImageUploadSchema = z.object({
  name: z.string().min(1).max(100),
  consentAcknowledged: z.enum(['true']).transform(() => true),
});

export const avatarImageGenerateSchema = z.object({
  name: z.string().min(1).max(100),
  prompt: z.string().min(1).max(1000),
});

export const createAvatarImageShareSchema = z.object({
  avatarImageId: z.string().min(1),
  message: z.string().max(500).optional(),
});

export const updateAvatarImageShareSchema = z.object({
  status: z.enum(['APPROVED', 'DENIED', 'REVOKED']),
});

export const updateAvatarImageSchema = z.object({
  shareable: z.boolean(),
});

// Sourced classes: build the next class from a real link or an interest topic.
export const sourcedClassSchema = z.object({
  sourceUrl: z.string().url().max(2048).optional(),
  topic: z.string().trim().min(1).max(200).optional(),
});

// Device pairing ("scan to connect")
export const pairDeviceSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
});

export const redeemPairingSchema = z.object({
  token: z.string().min(10).max(256),
});

// Owner-set server infrastructure (non-secret selection). Each field accepts a
// trimmed string to set, or null to clear (fall back to env). No secrets here.
// Empty strings are normalized to null in setSiteConfig.
const infraField = z.string().trim().max(512).nullable().optional();

export const serverInfraSchema = z.object({
  aiProvider: infraField,
  aiModel: infraField,
  aiBaseUrl: infraField,
  sttProvider: infraField,
  sttBaseUrl: infraField,
  sttModel: infraField,
  ttsProvider: infraField,
  ttsBaseUrl: infraField,
  storageProvider: infraField,
  s3Bucket: infraField,
  s3Region: infraField,
});

export const siteConfigUpdateSchema = serverInfraSchema.extend({
  openSignup: z.boolean().optional(),
  localAuth: z.boolean().nullable().optional(),
});

// Local profile sign-in (the Netflix-style picker). The Credentials authorize
// input: a user id from the picker and the password.
export const credentialsAuthSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

// First-run owner creation (public, only when local auth is on and zero users).
export const createOwnerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
  avatar: z.string().trim().max(64).optional(),
});

// Admin household member management.
export const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
  avatar: z.string().trim().max(64).optional(),
});

export const updateMemberSchema = z.object({
  memberId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  avatar: z.string().trim().max(64).optional(),
  resetPassword: z.string().min(8).max(200).optional(),
});

// Self-service password change.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

// Unified onboarding-wizard save. Per-user fields persist on every self-hosted
// save; `infra` persists only when the caller is the owner (enforced server-side).
// BYOK keys are NOT here — they flow through the validated /api/v1/settings/* routes.
const langCode2 = z.string().trim().toLowerCase().length(2);
const cefrLevel = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

export const onboardingSaveSchema = z.object({
  course: z.object({
    native: langCode2,
    target: langCode2,
    level: cefrLevel.optional(),
  }),
  note: z.string().trim().max(4000).optional(),
  preferred: z
    .object({
      language: z.string().trim().max(40).optional(),
      aiProvider: z.string().trim().max(64).optional(),
      aiModel: z.string().trim().max(128).optional(),
      ttsProvider: z.string().trim().max(64).optional(),
      ttsModel: z.string().trim().max(128).optional(),
    })
    .optional(),
  infra: serverInfraSchema.optional(),
});

// POST /api/v1/live-translate/token — mint an ephemeral Gemini Live token for a course.
export const liveTranslateTokenSchema = z.object({
  courseId: z.string().min(1),
  direction: z.enum(['native_to_target', 'target_to_native']),
});

// POST /api/v1/live-translate/session — persist a finished session's transcript so its
// new target-language vocabulary can be fed into the course memory graph.
export const liveTranslateSessionSchema = z.object({
  courseId: z.string().min(1),
  transcript: z.string().max(20000),
});

// POST /api/v1/exams — start a mock exam for a course (optional level override).
export const examStartSchema = z.object({
  courseId: z.string().min(1),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
});

// POST /api/v1/exams/[examId]/submit — submit MC answers and score the exam.
export const examSubmitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), selectedIndex: z.number().int().min(0) }))
    .max(200),
});

// PATCH /api/v1/courses/[courseId]/pedagogy — switch the course's teaching approach.
export const coursePedagogySchema = z.object({
  pedagogy: z.enum(['BALANCED', 'IMMERSION', 'GRAMMAR', 'COMMUNICATION', 'INTENSIVE']),
});
