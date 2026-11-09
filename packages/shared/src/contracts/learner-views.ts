import { z } from 'zod';
import { learningObjectiveMemorySchema } from '../learning-map/contracts';

// ---------------------------------------------------------------------------
// GET /api/v1/courses/{courseId}/graph — the vocabulary/grammar memory graph.
// Mirrors apps/web/src/lib/knowledge-graph.ts (getMemoryGraph). The route
// returns legacy nodes/edges plus separate pinned objective projections.
// `.loose()` on a legacy node tolerates additional display metadata.
// ---------------------------------------------------------------------------

export const memoryNodeSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['vocab', 'grammar']),
    label: z.string(),
    // Vocab nodes carry a translation; grammar nodes do not.
    translation: z.string().optional(),
    // 0..1 mastery strength.
    strength: z.number(),
    due: z.boolean(),
  })
  .loose();

export const memoryEdgeSchema = z
  .object({
    source: z.string(),
    target: z.string(),
    type: z.string(),
    weight: z.number(),
  })
  .loose();

export const memoryGraphResponseSchema = z
  .object({
    objectives: z.array(learningObjectiveMemorySchema),
    nodes: z.array(memoryNodeSchema),
    edges: z.array(memoryEdgeSchema),
  })
  .loose();

// ---------------------------------------------------------------------------
// GET /api/v1/courses/{courseId}/exams — the exam this course can sit plus the
// learner's past attempts. Mirrors listCourseExams in
// apps/web/src/lib/mock-exam-service.ts.
// ---------------------------------------------------------------------------

export const courseExamsResponseSchema = z
  .object({
    available: z
      .object({
        institution: z.string(),
        institutionLabel: z.string(),
        examName: z.string(),
        level: z.string(),
        sectionCount: z.number(),
      })
      .loose(),
    history: z.array(
      z
        .object({
          id: z.string(),
          examName: z.string(),
          level: z.string(),
          status: z.string(),
          band: z.string().nullable(),
          overallScore: z.number().nullable(),
          createdAt: z.string(),
        })
        .loose()
    ),
  })
  .loose();

// ---------------------------------------------------------------------------
// GET /api/v1/learn/activity — daily study activity + streaks, bucketed in the
// learner's timezone. `days` is an ISO-day-keyed object; quiet days are absent.
// ---------------------------------------------------------------------------

export const activityResponseSchema = z
  .object({
    timeZone: z.string(),
    todayIso: z.string(),
    days: z.record(z.string(), z.record(z.string(), z.number())),
    currentStreak: z.number(),
    longestStreak: z.number(),
  })
  .loose();

// ---------------------------------------------------------------------------
// GET /api/v1/onboarding/config — instance + owner config for the wizard. No
// secrets. Mirrors apps/web/src/app/api/v1/onboarding/config/route.ts:
// { selfHosted, isOwner, infra: {...non-secret provider/storage fields} | null }
// (`infra` is null unless self-hosted AND the user is the owner).
// ---------------------------------------------------------------------------

// `.loose()`: the non-secret infra projection. Every field is an optional/
// nullable display string; open to tolerate any provider fields added later.
export const onboardingInfraSchema = z
  .object({
    aiProvider: z.string().nullable().optional(),
    aiModel: z.string().nullable().optional(),
    aiBaseUrl: z.string().nullable().optional(),
    sttProvider: z.string().nullable().optional(),
    sttBaseUrl: z.string().nullable().optional(),
    sttModel: z.string().nullable().optional(),
    ttsProvider: z.string().nullable().optional(),
    ttsBaseUrl: z.string().nullable().optional(),
    storageProvider: z.string().nullable().optional(),
    s3Bucket: z.string().nullable().optional(),
    s3Region: z.string().nullable().optional(),
  })
  .loose();

export const onboardingConfigResponseSchema = z.object({
  selfHosted: z.boolean(),
  isOwner: z.boolean(),
  infra: onboardingInfraSchema.nullable(),
});

// ---------------------------------------------------------------------------
// GET /api/v1/users/me  (auth: bearer) — the authenticated learner's identity.
// `.loose()`: the route returns a richer row (episodeCount, voicePreferences,
// preferred*, createdAt, ...); the CLI reads only the identity subset and
// tolerates the extra fields. `id` is always present; the rest are nullable.
// Used by `sotto whoami` and the account switcher to show who a profile is.
// ---------------------------------------------------------------------------
export const meResponseSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// ADAPTIVE-LISTENING Q&A — ask a contextual question during a listening lesson.
//   POST /api/v1/episodes/{episodeId}/interact                  -> 201 Interaction
//   GET  /api/v1/episodes/{episodeId}/interact/{interactionId}  -> 200 Interaction
// Mirrors apps/web/src/app/api/v1/episodes/[episodeId]/interact + the Interaction
// model. The worker answers asynchronously; the client polls until the status is
// ANSWERED with a non-null `answer`. The answer is TEXT only — the Interaction
// model has no answer-audio field, so none is modeled (the loose response would
// tolerate one if the route ever adds it).
// ---------------------------------------------------------------------------

// Mirrors the Prisma `InteractionStatus` enum. There is no FAILED state — a
// worker failure leaves the interaction PENDING/ANSWERING (the client times out
// and surfaces an error); a content-policy block resolves to ANSWERED with a
// fallback answer text.
export const interactionStatusSchema = z.enum([
  'PENDING',
  'ANSWERING',
  'ANSWERED',
  'RESOLVED',
  'INCORPORATING',
  'INCORPORATED',
]);

// POST body: a contextual question + the playback position (seconds) it was
// asked at. `interactionSchema` on the route: question 1..2000, timestamp >= 0.
export const askInteractionRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  timestamp: z.number().min(0),
});

// `.loose()`: the POST returns the full Interaction row (plus `user`); the GET
// returns the safe projection. One open schema covers both — the client reads
// the shared subset and tolerates the POST's extra fields.
export const interactionResponseSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    timestamp: z.number(),
    status: interactionStatusSchema,
    // Populated once the worker finishes (ANSWERED); null while pending.
    answer: z.string().nullable(),
    helpful: z.boolean().nullable(),
    segmentOrder: z.number().nullable(),
  })
  .loose();
