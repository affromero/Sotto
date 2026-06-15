import { z } from 'zod';
import { isAnimalSlug } from './avatars';

/**
 * Discovery chat message validation
 */
export const discoveryMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  episodeId: z.string().optional(),
});

/**
 * Episode creation validation — canonical schema lives in @sotto/shared
 */
export { createEpisodeSchema } from '@sotto/shared';

const explicitTtsProviderSchema = z.enum([
  'elevenlabs',
  'openai',
  'cartesia',
  'hume',
  'fal',
  'replicate',
  'minimax',
  'mistral',
  'kokoro',
  'local',
]);

const agentProviderSchema = z.enum(['claude-code', 'codex', 'openclaw', 'hermes', 'custom']);

/**
 * Private agent-output ingestion. This is intentionally separate from generic
 * episode creation so local agents can post source material without exposing a
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
 * Episode update validation
 */
export const updateEpisodeSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    topic: z.string().min(1).max(5000).optional(),
    visibility: z.enum(['UNLISTED', 'PRIVATE']).optional(),
  })
  .strict();

/**
 * User profile update validation
 */
/**
 * Household profile schemas. A profile name reuses the User.name trim/length
 * rules; the avatar is one of the preset animal slugs (validated against the
 * registry, never a free string).
 */
const profileNameSchema = z
  .string()
  .transform((val) => val.trim())
  .pipe(z.string().min(1).max(100));

const avatarSlugSchema = z.string().refine(isAnimalSlug, 'Unknown avatar');

export const createProfileSchema = z
  .object({
    name: profileNameSchema,
    avatarSlug: avatarSlugSchema.optional(),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    name: profileNameSchema.optional(),
    avatarSlug: avatarSlugSchema.optional(),
  })
  .strict();

export const switchProfileSchema = z
  .object({
    profileId: z.string().min(1),
  })
  .strict();

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
 * Voice preview validation
 */
export const voicePreviewSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).max(500),
  provider: z
    .enum([
      'elevenlabs',
      'hume',
      'cartesia',
      'openai',
      'fal',
      'replicate',
      'minimax',
      'mistral',
      'kokoro',
      'local',
    ])
    .refine((value) => value.length > 0),
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
      sttProvider: z.string().optional(),
    })
    .optional(),
});

export const updateDraftSchema = z.object({
  draftData: z.record(z.string(), z.unknown()).optional(),
  metadata: draftMetadataSchema.optional(),
});

export const appendDraftMessagesSchema = z.object({
  messages: z.array(draftMessageSchema).min(1),
  metadata: draftMetadataSchema.optional(),
});

/**
 * Import episode validation
 */
export const importEpisodeSchema = z.object({
  title: z.string().max(200).optional(),
  topic: z.string().max(5000).optional(),
  sourcePlatform: z.string().min(1).max(50),
  sttProvider: z.enum(['openai', 'elevenlabs', 'together', 'deepgram', 'assemblyai', 'local']).optional(),
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

export const siteConfigUpdateSchema = serverInfraSchema;

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
