// Zod schemas for the core /api/v1 endpoints the terminal client consumes.
// Request schemas reuse the canonical web validators where one already exists;
// response schemas are authored here to mirror the actual route behavior
// (read against the routes + practice-service, not invented).
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

// How a course's level was established (null on legacy courses placed before the
// field existed). Mirrors the Prisma PlacementSource enum.
export const placementSourceSchema = z.enum(['TEST', 'NOTES', 'NOTES_VERIFIED', 'MANUAL']);

export const practiceKindSchema = z.enum([
  'FULL',
  'GRAMMAR',
  'READING',
  'LISTENING',
  'SPEAKING',
  'WRITING',
  'VOCAB',
]);

export const practiceStatusSchema = z.enum(['ACTIVE', 'COMPLETED']);

export const userRoleSchema = z.enum(['USER', 'ADMIN']);

export const focusTargetKindSchema = z.enum(['WORD', 'PHRASE', 'SENTENCE']);

export const focusTargetSourceSchema = z.enum([
  'TRANSCRIPT',
  'CLASS',
  'PRACTICE',
  'NOTES',
  'LIVE',
  'MANUAL',
]);

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
  placementSource: placementSourceSchema.nullable(),
  activeClassId: z.string().nullable(),
  curriculum: z.object({ title: z.string() }),
  placement: z.object({ level: cefrLevelSchema, createdAt: z.string() }).nullable(),
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
  focusTargetId: z.string().min(1).optional(),
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

export const startPracticeReadyFullSchema = z.object({
  status: z.literal('ready_full'),
  sessionId: z.string(),
  kind: z.literal('FULL'),
  items: z.array(practiceItemSchema),
  episodeId: z.string().optional(),
  speakingPrompts: z.array(practiceSpeakingPromptSchema),
  writingPrompts: z.array(practiceWritingPromptSchema),
});

export const startPracticeResponseSchema = z.discriminatedUnion('status', [
  startPracticeUnavailableSchema,
  startPracticeReadySchema,
  startPracticeReadySpeakingSchema,
  startPracticeReadyWritingSchema,
  startPracticeReadyFullSchema,
]);

// ---------------------------------------------------------------------------
// Learning targets — learner-marked words, phrases, and sentences that should
// stay emphasized in adaptive practice without turning into translations.
// ---------------------------------------------------------------------------

export const learningTargetSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  kind: focusTargetKindSchema,
  text: z.string(),
  normalizedText: z.string(),
  contextText: z.string().nullable(),
  sourceType: focusTargetSourceSchema,
  sourceId: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  userMarkedDifficulty: z.number(),
  priorityBoost: z.number(),
  visualCueUrl: z.string().nullable(),
  visualCueAlt: z.string().nullable(),
  visualCueAttribution: z.string().nullable(),
  visualCueProvider: z.string().nullable(),
  pronunciationAudioUrl: z.string().nullable(),
  lastSelectedAt: z.string(),
  lastPracticedAt: z.string().nullable(),
});

export const listLearningTargetsResponseSchema = z.object({
  targets: z.array(learningTargetSchema),
});

export const addLearningTargetRequestSchema = z.object({
  text: z.string().min(1).max(500),
  kind: focusTargetKindSchema.optional(),
  contextText: z.string().max(2000).nullable().optional(),
  sourceType: focusTargetSourceSchema.optional(),
  sourceId: z.string().max(200).nullable().optional(),
  sourceLabel: z.string().max(200).nullable().optional(),
  userMarkedDifficulty: z.number().int().min(1).max(5).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/v1/practice/{sessionId}/submit  (auth: bearer)
// Request mirrors submitSchema; response mirrors SubmitPracticeResult.
// ---------------------------------------------------------------------------

export const submitPracticeRequestSchema = z.object({
  answers: z.array(
    z.object({
      itemId: z.string().min(1),
      selectedIndex: z.number().int().min(0),
    })
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

export const speakingGradeStatusSchema = z.enum(['PENDING', 'GRADING', 'SCORED', 'FAILED']);

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
// CLASSES — the gated CEFR curriculum flow.
//   POST /api/v1/courses/{courseId}/next-class  -> { classId } | { done: true }
//   GET  /api/v1/classes/{classId}              -> class + sections
//   POST /api/v1/classes/{classId}/submit       -> grade result
// Class speaking/writing prompts are submitted via their own endpoints (see
// classes/{classId}/speaking|writing) — the class submit only grades MC answers.
// Worksheet (PDF) and ink (PencilKit) routes are intentionally out of scope for
// the terminal client (not renderable headless).
//
// Mirrors apps/web/src/lib/class-service.ts + the classes/[classId] GET route.
// Sections are a FLAT row keyed by `skill` (not a discriminated union): every
// section carries `questions`, `prompts`, and `writingPrompts` arrays, mostly
// empty depending on its skill. The client reads the array matching `skill`.
// ---------------------------------------------------------------------------

// Mirrors the Prisma `SkillType` enum (gates the four class section skills).
export const skillTypeSchema = z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']);

// Mirrors the Prisma `ClassStatus` enum.
export const classStatusSchema = z.enum([
  'LOCKED',
  'GENERATING',
  'AVAILABLE',
  'IN_PROGRESS',
  'SUBMITTED',
  'PASSED',
  'FAILED',
]);

// Mirrors the Prisma `SectionStatus` enum.
export const sectionStatusSchema = z.enum([
  'PENDING',
  'GENERATING',
  'READY',
  'IN_PROGRESS',
  'SUBMITTED',
  'PASSED',
  'FAILED',
]);

// `.loose()`: the route adds correctIndex/explanation only after submission, so
// the open object covers both the pre- and post-submit projections.
export const classQuestionSchema = z
  .object({
    id: z.string(),
    order: z.number().int(),
    question: z.string(),
    options: z.array(z.string()),
    passageRef: z.string().nullable(),
    // Sourced-class READING passage; null for curriculum classes.
    passageText: z.string().nullable(),
  })
  .loose();

export const classSpeakingPromptSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  targetPhrase: z.string(),
  translation: z.string(),
  ipa: z.string().nullable(),
  referenceTtsUrl: z.string().nullable(),
});

// `.loose()`: `response` is a graded WritingResponse row (text/score/corrections/
// feedback) the client only reads loosely; keep it open.
export const classWritingPromptSchema = z
  .object({
    id: z.string(),
    order: z.number().int(),
    task: z.string(),
    guidance: z.string().nullable(),
  })
  .loose();

// `.loose()`: the section's episode carries a `references` Json the client
// ignores; the playable `audioUrl` is what the listening screen uses.
export const classEpisodeRefSchema = z
  .object({
    id: z.string(),
    audioUrl: z.string().nullable(),
    title: z.string(),
  })
  .loose();

// `.loose()`: a flat section row with all content arrays. Open because the route
// returns more per-row fields than the client renders.
export const classSectionSchema = z
  .object({
    id: z.string(),
    skill: skillTypeSchema,
    status: sectionStatusSchema,
    questions: z.array(classQuestionSchema),
    prompts: z.array(classSpeakingPromptSchema),
    writingPrompts: z.array(classWritingPromptSchema),
    episode: classEpisodeRefSchema.nullable(),
  })
  .loose();

// `.loose()`: the class carries `lesson` + `submission` (Json) and sourced-class
// attribution the client does not need; only the modeled fields are read.
export const classDetailResponseSchema = z
  .object({
    id: z.string(),
    courseId: z.string(),
    status: classStatusSchema,
    order: z.number().int(),
    passThreshold: z.number(),
    submitted: z.boolean(),
    sections: z.array(classSectionSchema),
  })
  .loose();

// next-class returns EXACTLY one of two closed shapes, distinguished by status:
//   201 -> { classId }   (a class was created/returned)
//   200 -> { done: true } (the course curriculum is complete)
// Each is modeled as its own closed schema and emitted under its own status code
// (see the per-status `responses` map in endpoints.ts). The 409 "gated" case is
// an error response, not a success body, so it is not modeled here.
export const nextClassCreatedResponseSchema = z.object({
  classId: z.string(),
});

export const nextClassDoneResponseSchema = z.object({
  done: z.literal(true),
});

// POST /api/v1/classes/{classId}/submit — MC answers only (speaking/writing are
// graded via their own endpoints). selectedIndex is 0..3 per the route.
export const submitClassRequestSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        selectedIndex: z.number().int().min(0).max(3),
      })
    )
    .min(1),
});

export const submitClassSectionResultSchema = z.object({
  id: z.string(),
  skill: skillTypeSchema,
  score: z.number(),
  passed: z.boolean(),
});

export const submitClassResponseSchema = z.object({
  passed: z.boolean(),
  overallScore: z.number(),
  passedSections: z.number(),
  totalSections: z.number(),
  sections: z.array(submitClassSectionResultSchema),
});

// ---------------------------------------------------------------------------
// EXAMS — ungated, full-length mock exams (no course-level advance).
//   POST /api/v1/exams                  -> { examId } (201)
//   GET  /api/v1/exams/{examId}         -> exam + sections + (when scored) result
//   POST /api/v1/exams/{examId}/submit  -> band/score result
// Exam speaking/writing prompts are submitted via their own per-prompt endpoints
// (mirroring classes); the exam submit only carries MC answers.
//
// Mirrors apps/web/src/lib/mock-exam-service.ts (getExamForUser) + the scoring
// service. Exam sections parallel class sections but carry exam-only metadata
// (`part`, `format`, `weight`) and a different episode projection (status, no
// title/references). The MC question and writing-prompt shapes are identical to
// classes, so those schemas are reused; the speaking prompt differs (no `ipa`).
// ---------------------------------------------------------------------------

// Mirrors the Prisma `MockExamStatus` enum.
export const mockExamStatusSchema = z.enum([
  'GENERATING',
  'READY',
  'IN_PROGRESS',
  'SUBMITTED',
  'SCORED',
  'FAILED',
]);

// Exam speaking prompt — like the class one but without `ipa` (the exam route
// does not surface it). Closed: this is exactly what the route projects.
export const examSpeakingPromptSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  targetPhrase: z.string(),
  translation: z.string(),
  referenceTtsUrl: z.string().nullable(),
});

// `.loose()`: the exam section's episode projection is `{ id, audioUrl, status }`
// (no title/references, unlike classes). Open to tolerate any extra fields.
export const examEpisodeRefSchema = z
  .object({
    id: z.string(),
    audioUrl: z.string().nullable(),
    status: episodeStatusSchema,
  })
  .loose();

// `.loose()`: a flat exam-section row. Carries exam-only metadata (part, format,
// weight) plus the per-skill content arrays. The MC question and writing-prompt
// shapes are reused from classes.
export const examSectionSchema = z
  .object({
    id: z.string(),
    skill: skillTypeSchema,
    part: z.string(),
    order: z.number().int(),
    format: z.string(),
    weight: z.number(),
    // Prisma `SectionStatus` (same enum the class section uses).
    status: sectionStatusSchema,
    score: z.number().nullable(),
    episode: examEpisodeRefSchema.nullable(),
    questions: z.array(classQuestionSchema),
    speakingPrompts: z.array(examSpeakingPromptSchema),
    writingPrompts: z.array(classWritingPromptSchema),
  })
  .loose();

// The scored exam result (present only once status is SCORED).
export const examResultSchema = z
  .object({
    overallScore: z.number().nullable(),
    band: z.string().nullable(),
    feedback: z.string().nullable(),
    sectionResults: z.array(
      z
        .object({
          sectionId: z.string(),
          skill: skillTypeSchema,
          score: z.number(),
          feedback: z.string().nullable(),
        })
        .loose()
    ),
  })
  .loose();

// `.loose()`: the exam carries institution metadata the client renders plus
// fields it ignores; only the modeled fields are read.
export const examDetailResponseSchema = z
  .object({
    id: z.string(),
    institution: z.string(),
    institutionLabel: z.string(),
    level: cefrLevelSchema,
    status: mockExamStatusSchema,
    examName: z.string(),
    sections: z.array(examSectionSchema),
    // The scored result; null until the exam is submitted/scored.
    result: examResultSchema.nullable(),
  })
  .loose();

// POST /api/v1/exams — start a mock exam for a course at an optional level.
export const startExamRequestSchema = z.object({
  courseId: z.string().min(1),
  level: cefrLevelSchema.optional(),
});

export const startExamResponseSchema = z.object({
  examId: z.string(),
});

// POST /api/v1/exams/{examId}/submit — MC answers only (max 200; an EMPTY array
// is accepted — speaking/writing are graded per-prompt during the exam). Unlike
// the class submit, this route has no `.min(1)`.
export const submitExamRequestSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        selectedIndex: z.number().int().min(0),
      })
    )
    .max(200),
});

export const examSectionScoreSchema = z.object({
  sectionId: z.string(),
  skill: skillTypeSchema,
  weight: z.number(),
  score: z.number(),
});

export const submitExamResponseSchema = z.object({
  overallScore: z.number(),
  band: z.string(),
  sections: z.array(examSectionScoreSchema),
  feedback: z.string(),
});

// ---------------------------------------------------------------------------
// PLACEMENT — assess a CEFR level and create/update the course. Two steps:
//   GET  /api/v1/placement?native=&target=  -> generated MC questions
//   POST /api/v1/placement                  -> { courseId, level, scoreBySkill }
// Mirrors apps/web/src/app/api/v1/placement/route.ts + lib/placement-test.ts
// (`toPublic`). Both responses are the exact projections the route returns, so
// they are closed.
// ---------------------------------------------------------------------------

// The public projection of a placement question (the answer key is stripped).
export const placementQuestionSchema = z.object({
  id: z.string(),
  cefr: cefrLevelSchema,
  // PLACEMENT_SKILLS = grammar | vocab | reading (display-only here).
  skill: z.string(),
  prompt: z.string(),
  options: z.array(z.string()),
});

export const generatePlacementResponseSchema = z.object({
  native: z.string(),
  target: z.string(),
  questions: z.array(placementQuestionSchema),
});

// POST body: the answered questions for the (native, target) pair. selectedIndex
// is 0..3 for a content option and 4 for the "I don't know" option; at least one
// answer is required (`.min(1)`).
export const submitPlacementRequestSchema = z.object({
  native: z.string().length(2),
  target: z.string().length(2),
  answers: z
    .array(
      z.object({
        id: z.string(),
        selectedIndex: z.number().int().min(0).max(4),
      })
    )
    .min(1),
});

export const submitPlacementResponseSchema = z.object({
  courseId: z.string(),
  level: cefrLevelSchema,
  // Per-skill ratios (0..1), keyed by skill name.
  scoreBySkill: z.record(z.string(), z.number()),
});

// ---------------------------------------------------------------------------
// POST /api/v1/placement/from-notes — deduce a CEFR level from pasted materials
// (JSON). Mirrors apps/web/src/app/api/v1/placement/from-notes/route.ts. Web
// file uploads use a separate multipart route (not in the contract).
// ---------------------------------------------------------------------------

export const deduceFromNotesRequestSchema = z.object({
  native: z.string().length(2),
  target: z.string().length(2),
  content: z.string().min(1),
});

export const deduceFromNotesResponseSchema = z.object({
  native: z.string(),
  target: z.string(),
  deducedLevel: cefrLevelSchema,
  rationale: z.string(),
  confidence: z.number(),
});

// POST /api/v1/placement/from-notes/confirm — accept the deduced level, create
// the course, and seed the note + vocabulary. Mirrors the confirm route.
export const confirmFromNotesRequestSchema = z.object({
  native: z.string().length(2),
  target: z.string().length(2),
});

export const confirmFromNotesResponseSchema = z.object({
  courseId: z.string(),
  level: cefrLevelSchema,
  addedVocabulary: z.number(),
});

// ---------------------------------------------------------------------------
// POST /api/v1/placement/manual — the learner declares their own CEFR level.
// Creates the course at that level or raises to it (lowering is a reset).
// Mirrors apps/web/src/app/api/v1/placement/manual/route.ts.
// ---------------------------------------------------------------------------

export const manualPlacementRequestSchema = z.object({
  native: z.string().length(2),
  target: z.string().length(2),
  level: cefrLevelSchema,
});

export const manualPlacementResponseSchema = z.object({
  courseId: z.string(),
  level: cefrLevelSchema,
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/courses/{courseId} — permanently delete a course and everything
// tied to it (graph, classes, exams, practice, generated episodes, stored files).
// `confirm` must echo the course's target language. Mirrors the DELETE route.
// ---------------------------------------------------------------------------

export const deleteCourseRequestSchema = z.object({
  confirm: z.string(),
});

export const deleteCourseResponseSchema = z.object({
  deleted: z.boolean(),
  episodesDeleted: z.number(),
  filesAttempted: z.number(),
  filesDeleted: z.number(),
  filesFailed: z.number(),
});

// ---------------------------------------------------------------------------
// GET /api/v1/courses/{courseId}/graph — the vocabulary/grammar memory graph.
// Mirrors apps/web/src/lib/knowledge-graph.ts (getMemoryGraph). The route
// returns exactly `{ nodes, edges }`; `.loose()` on the node tolerates any
// extra fields a future projection adds.
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
  image: z.string().nullable(),
  role: userRoleSchema,
});

export const redeemPairingResponseSchema = z.object({
  token: z.string(),
  user: pairedUserSchema.nullable(),
});
