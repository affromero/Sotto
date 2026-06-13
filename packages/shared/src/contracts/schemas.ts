// Zod schemas for the core /api/v1 endpoints the terminal client consumes.
// Request schemas reuse the canonical web validators where one already exists;
// response schemas are authored here to mirror the actual route behavior
// (read against the routes + practice-service, not invented).
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

export const practiceKindSchema = z.enum([
  'GRAMMAR',
  'READING',
  'LISTENING',
  'SPEAKING',
  'WRITING',
  'VOCAB',
]);

export const practiceStatusSchema = z.enum(['ACTIVE', 'COMPLETED']);

export const userRoleSchema = z.enum(['USER', 'ADMIN']);

// ---------------------------------------------------------------------------
// GET /api/v1/health  (auth: none)
// Mirrors HealthData in apps/web/src/lib/health.ts. Unauthenticated callers get
// { status, version, timestamp }; the admin path additionally returns checks,
// vapid, and env, so those are optional.
// ---------------------------------------------------------------------------

export const healthCheckResultSchema = z.object({
  status: z.string(),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded']),
  timestamp: z.string(),
  version: z.string().optional(),
  checks: z.record(z.string(), healthCheckResultSchema).optional(),
  oauth: z.record(z.string(), z.boolean()).optional(),
  vapid: z.boolean().optional(),
  env: z.record(z.string(), z.boolean()).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/v1/courses  (auth: bearer)
// Mirrors the GET select in apps/web/src/app/api/v1/courses/route.ts.
// ---------------------------------------------------------------------------

export const courseSummarySchema = z.object({
  id: z.string(),
  nativeLang: z.string(),
  targetLang: z.string(),
  currentLevel: cefrLevelSchema,
  startLevel: cefrLevelSchema,
  activeClassId: z.string().nullable(),
  curriculum: z.object({ title: z.string() }),
  placement: z
    .object({ level: cefrLevelSchema, createdAt: z.string() })
    .nullable(),
});

export const coursesListResponseSchema = z.object({
  courses: z.array(courseSummarySchema),
});

// ---------------------------------------------------------------------------
// GET /api/v1/courses/{courseId}/practice  (auth: bearer)
// Mirrors the GET response in the practice route: due counts, total vocab, and
// the 10 most recent practice sessions (the PracticeSession select).
// ---------------------------------------------------------------------------

export const practiceRecentSessionSchema = z.object({
  id: z.string(),
  kind: practiceKindSchema,
  status: practiceStatusSchema,
  score: z.number().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const practiceOverviewResponseSchema = z.object({
  due: z.object({ vocab: z.number(), grammar: z.number() }),
  totalVocab: z.number(),
  recent: z.array(practiceRecentSessionSchema),
});

// ---------------------------------------------------------------------------
// POST /api/v1/courses/{courseId}/practice  (auth: bearer)
// Request mirrors startSchema; response mirrors StartPracticeResult in
// apps/web/src/lib/practice-service.ts (discriminated on `status`).
// ---------------------------------------------------------------------------

export const startPracticeRequestSchema = z.object({
  kind: practiceKindSchema,
});

// Public projection of a multiple-choice item (toPublic drops the answer).
export const practiceItemSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  options: z.array(z.string()),
});

export const practiceSpeakingPromptSchema = z.object({
  id: z.string(),
  targetPhrase: z.string(),
  translation: z.string(),
  referenceTtsUrl: z.string().nullable(),
});

export const practiceWritingPromptSchema = z.object({
  id: z.string(),
  task: z.string(),
  guidance: z.string().nullable(),
});

// Each StartPractice variant is its own schema so it can be registered as a
// named OpenAPI component and referenced from the response's oneOf/discriminator.
export const startPracticeUnavailableSchema = z.object({
  status: z.literal('unavailable'),
  reason: z.enum(['not_enough_vocab', 'nothing_due', 'no_content']),
});

export const startPracticeReadySchema = z.object({
  status: z.literal('ready'),
  sessionId: z.string(),
  kind: practiceKindSchema,
  items: z.array(practiceItemSchema),
  episodeId: z.string().optional(),
});

export const startPracticeReadySpeakingSchema = z.object({
  status: z.literal('ready_speaking'),
  sessionId: z.string(),
  prompts: z.array(practiceSpeakingPromptSchema),
});

export const startPracticeReadyWritingSchema = z.object({
  status: z.literal('ready_writing'),
  sessionId: z.string(),
  prompts: z.array(practiceWritingPromptSchema),
});

export const startPracticeResponseSchema = z.discriminatedUnion('status', [
  startPracticeUnavailableSchema,
  startPracticeReadySchema,
  startPracticeReadySpeakingSchema,
  startPracticeReadyWritingSchema,
]);

// ---------------------------------------------------------------------------
// POST /api/v1/practice/{sessionId}/submit  (auth: bearer)
// Request mirrors submitSchema; response mirrors SubmitPracticeResult.
// ---------------------------------------------------------------------------

export const submitPracticeRequestSchema = z.object({
  answers: z.array(
    z.object({
      itemId: z.string().min(1),
      selectedIndex: z.number().int().min(0),
    }),
  ),
});

export const submitPracticeResponseSchema = z.object({
  score: z.number(),
  correct: z.number(),
  total: z.number(),
});

// ---------------------------------------------------------------------------
// GET /api/v1/episodes/{episodeId}  (auth: bearer for private; public otherwise)
// The listening backbone. Mirrors the GET response in
// apps/web/src/app/api/v1/episodes/[episodeId]/route.ts: the episode plus its
// ordered segments, each with `audioUrl` resolved by resolveAudioUrl to a
// playable (presigned for PRIVATE/UNLISTED, CDN for PUBLIC) URL. Only the fields
// the terminal client plays/renders are modeled; the route returns a superset
// (tags, interactions, isSaved, etc.) that the client ignores.
// ---------------------------------------------------------------------------

// Mirrors the Prisma `EpisodeStatus` enum (apps/web/prisma/schema.prisma);
// keep in sync when that enum changes.
export const episodeStatusSchema = z.enum([
  'PENDING',
  'DISCOVERING',
  'EXTRACTING',
  'RESEARCHING',
  'PLANNING',
  'SCRIPTING',
  'COMPILING',
  'SCRIPT_READY',
  'GENERATING_AUDIO',
  'STITCHING',
  'READY',
  'UPDATING',
  'FAILED',
  'IMPORTING',
  'TRANSCRIBING',
]);

// `.loose()`: the route returns the full Prisma segment row (episodeId,
// wordTimings, version, ttsProvider, createdAt, updatedAt, ...). We model only
// the fields the terminal client reads and leave the object OPEN so the
// contract is truthful and the generated client tolerates the extra fields
// (loose objects never emit `additionalProperties: false`).
export const episodeSegmentSchema = z
  .object({
    id: z.string(),
    speaker: z.string(),
    text: z.string(),
    // Resolved to a playable URL by the route; null when the segment has no audio.
    audioUrl: z.string().nullable(),
    order: z.number().int(),
    startTime: z.number().nullable(),
    duration: z.number().nullable(),
  })
  .loose();

// `.loose()`: the route returns the whole episode (tags, interactions, isSaved,
// fileSize, slug, ...). Open object — model only what the client renders/plays.
export const episodeDetailResponseSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: episodeStatusSchema,
    // Stitched full-episode audio, resolved to a playable URL; null until ready.
    audioUrl: z.string().nullable(),
    duration: z.number().nullable(),
    language: z.string().nullable(),
    segments: z.array(episodeSegmentSchema),
  })
  .loose();

// ---------------------------------------------------------------------------
// GET /api/v1/practice/{sessionId}/speaking/{promptId}?recordingId=...
//   (auth: bearer)
// Grading poll for an uploaded speaking attempt. Mirrors the GET select in
// apps/web/src/app/api/v1/practice/[sessionId]/speaking/[promptId]/route.ts.
// The upload itself is multipart and intentionally NOT in the contract — the
// Rust client posts it with raw reqwest. The route also returns rubricScores
// and phonemeScores (Json); the terminal client only uses these scalar fields.
// ---------------------------------------------------------------------------

export const speakingGradeStatusSchema = z.enum([
  'PENDING',
  'GRADING',
  'SCORED',
  'FAILED',
]);

// `.loose()`: the GET route also returns rubricScores and phonemeScores (Json).
// We model only the scalar fields the client uses and keep the object OPEN so
// the contract is truthful about the superset the route returns.
export const speakingPollResponseSchema = z
  .object({
    status: speakingGradeStatusSchema,
    // 0..1 combined pronunciation score; null until SCORED.
    overallScore: z.number().nullable(),
    transcript: z.string().nullable(),
    feedback: z.string().nullable(),
  })
  .loose();

// ---------------------------------------------------------------------------
// POST /api/v1/auth/pair/redeem  (auth: none — the pairing token is the credential)
// Request mirrors redeemPairingSchema; response mints an sk_sotto_ API key and
// returns the owning user (the findUnique select), which can be null.
// ---------------------------------------------------------------------------

export const redeemPairingRequestSchema = z.object({
  token: z.string().min(10).max(256),
});

export const pairedUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  handle: z.string().nullable(),
  image: z.string().nullable(),
  role: userRoleSchema,
});

export const redeemPairingResponseSchema = z.object({
  token: z.string(),
  user: pairedUserSchema.nullable(),
});
