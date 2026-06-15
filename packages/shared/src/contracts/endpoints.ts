// The contract registry: a flat list of the /api/v1 endpoints the terminal
// client (and the Rust codegen phase) target. Each entry pairs an HTTP method +
// path with its Zod request/response schemas so a single source generates both
// the OpenAPI document and any client-side validation.
import { z } from 'zod';
import {
  askInteractionRequestSchema,
  classDetailResponseSchema,
  coursesListResponseSchema,
  episodeDetailResponseSchema,
  examDetailResponseSchema,
  generatePlacementResponseSchema,
  healthResponseSchema,
  interactionResponseSchema,
  meResponseSchema,
  memoryGraphResponseSchema,
  nextClassCreatedResponseSchema,
  nextClassDoneResponseSchema,
  onboardingConfigResponseSchema,
  practiceOverviewResponseSchema,
  redeemPairingRequestSchema,
  redeemPairingResponseSchema,
  speakingPollResponseSchema,
  startExamRequestSchema,
  startExamResponseSchema,
  startPracticeRequestSchema,
  startPracticeResponseSchema,
  submitClassRequestSchema,
  submitClassResponseSchema,
  submitExamRequestSchema,
  submitExamResponseSchema,
  submitPlacementRequestSchema,
  submitPlacementResponseSchema,
  deduceFromNotesRequestSchema,
  deduceFromNotesResponseSchema,
  confirmFromNotesRequestSchema,
  confirmFromNotesResponseSchema,
  submitPracticeRequestSchema,
  submitPracticeResponseSchema,
} from './schemas';

// A query-string parameter on a GET endpoint. Always typed as a string in the
// OpenAPI document (the route reads searchParams as strings).
export interface QueryParamDef {
  name: string;
  required: boolean;
}

export interface EndpointDef {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  auth: 'bearer' | 'none';
  request?: z.ZodType;
  // A response schema. Use ONE of:
  //   - `response` + optional `successStatuses`: the same schema for every
  //     listed status (defaults to [200]).
  //   - `responses`: a DISTINCT schema per status code, when the route returns
  //     genuinely different shapes per status (e.g. next-class 201 {classId} vs
  //     200 {done}). Exactly one of `response`/`responses` must be set.
  response?: z.ZodType;
  responses?: Record<number, z.ZodType>;
  // Query-string parameters (path params are derived from the path template).
  query?: QueryParamDef[];
  // HTTP statuses the route can return with the (single) `response` schema.
  // Verified against the route handlers. Defaults to [200] when omitted.
  // Ignored when `responses` is used.
  successStatuses?: number[];
  // When true, this operation is documented in the truthful `openapi.json` but
  // EXCLUDED from the progenitor codegen spec (`openapi.codegen.json`). Used for
  // operations progenitor cannot generate (e.g. `nextClass`, whose 200 and 201
  // carry genuinely different bodies — progenitor allows only one 2xx body per
  // operation). The Rust client hand-rolls these via raw reqwest.
  codegenExclude?: boolean;
}

export const endpoints: EndpointDef[] = [
  {
    id: 'health',
    method: 'GET',
    path: '/api/v1/health',
    summary: 'Liveness and dependency health for the instance.',
    auth: 'none',
    response: healthResponseSchema,
    // route returns 200 when healthy, 503 (same body) when degraded.
    successStatuses: [200, 503],
  },
  {
    id: 'listCourses',
    method: 'GET',
    path: '/api/v1/courses',
    summary: "List the authenticated learner's courses.",
    auth: 'bearer',
    response: coursesListResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'getPracticeOverview',
    method: 'GET',
    path: '/api/v1/courses/{courseId}/practice',
    summary: 'Due counts per skill, total vocab, and recent practice sessions.',
    auth: 'bearer',
    response: practiceOverviewResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'startPractice',
    method: 'POST',
    path: '/api/v1/courses/{courseId}/practice',
    summary: 'Start an ungated, single-skill practice session.',
    auth: 'bearer',
    request: startPracticeRequestSchema,
    response: startPracticeResponseSchema,
    // 200 when the session is unavailable; 201 when a session is created.
    successStatuses: [200, 201],
  },
  {
    id: 'submitPractice',
    method: 'POST',
    path: '/api/v1/practice/{sessionId}/submit',
    summary: 'Grade a practice session and update spaced-repetition state.',
    auth: 'bearer',
    request: submitPracticeRequestSchema,
    response: submitPracticeResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'getEpisode',
    method: 'GET',
    path: '/api/v1/episodes/{episodeId}',
    summary: 'Episode detail with ordered segments and playable audio URLs.',
    auth: 'bearer',
    response: episodeDetailResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'pollSpeaking',
    method: 'GET',
    path: '/api/v1/practice/{sessionId}/speaking/{promptId}',
    summary: 'Poll grading status for an uploaded speaking attempt.',
    auth: 'bearer',
    query: [{ name: 'recordingId', required: true }],
    response: speakingPollResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'nextClass',
    method: 'POST',
    path: '/api/v1/courses/{courseId}/next-class',
    summary: 'Create/advance to the next gated class (or report the course done).',
    auth: 'bearer',
    // Distinct closed shapes per status: 201 { classId } on create, 200
    // { done: true } when the curriculum is complete.
    responses: {
      200: nextClassDoneResponseSchema,
      201: nextClassCreatedResponseSchema,
    },
    // progenitor cannot generate an operation with two distinct 2xx bodies, so
    // this stays in the truthful spec but is hand-rolled in the Rust client.
    codegenExclude: true,
  },
  {
    id: 'getClass',
    method: 'GET',
    path: '/api/v1/classes/{classId}',
    summary: 'A gated class with its ordered, mixed-skill sections.',
    auth: 'bearer',
    response: classDetailResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'submitClass',
    method: 'POST',
    path: '/api/v1/classes/{classId}/submit',
    summary: 'Grade a class submission and release the gate on pass.',
    auth: 'bearer',
    request: submitClassRequestSchema,
    response: submitClassResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'startExam',
    method: 'POST',
    path: '/api/v1/exams',
    summary: 'Start a full-length mock exam for a course.',
    auth: 'bearer',
    request: startExamRequestSchema,
    response: startExamResponseSchema,
    // The route always returns 201 { examId } (single 2xx body).
    successStatuses: [201],
  },
  {
    id: 'getExam',
    method: 'GET',
    path: '/api/v1/exams/{examId}',
    summary: 'A mock exam with its ordered sections and (once scored) result.',
    auth: 'bearer',
    response: examDetailResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'submitExam',
    method: 'POST',
    path: '/api/v1/exams/{examId}/submit',
    summary: 'Score a completed mock exam and return the band breakdown.',
    auth: 'bearer',
    request: submitExamRequestSchema,
    response: submitExamResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'generatePlacement',
    method: 'GET',
    path: '/api/v1/placement',
    summary: 'Generate an adaptive placement batch for a native/target pair.',
    auth: 'bearer',
    query: [
      { name: 'native', required: true },
      { name: 'target', required: true },
    ],
    response: generatePlacementResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'submitPlacement',
    method: 'POST',
    path: '/api/v1/placement',
    summary: 'Submit placement answers; assign a CEFR level and create the course.',
    auth: 'bearer',
    request: submitPlacementRequestSchema,
    response: submitPlacementResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'deducePlacementFromNotes',
    method: 'POST',
    path: '/api/v1/placement/from-notes',
    summary: 'Deduce a CEFR level from pasted materials (creates no course).',
    auth: 'bearer',
    request: deduceFromNotesRequestSchema,
    response: deduceFromNotesResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'confirmPlacementFromNotes',
    method: 'POST',
    path: '/api/v1/placement/from-notes/confirm',
    summary: 'Accept the deduced level; create the course and seed note + vocab.',
    auth: 'bearer',
    request: confirmFromNotesRequestSchema,
    response: confirmFromNotesResponseSchema,
    successStatuses: [201],
  },
  {
    id: 'getGraph',
    method: 'GET',
    path: '/api/v1/courses/{courseId}/graph',
    summary: "The course's vocabulary/grammar memory graph.",
    auth: 'bearer',
    response: memoryGraphResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'onboardingConfig',
    method: 'GET',
    path: '/api/v1/onboarding/config',
    summary: 'Instance + owner config (self-hosted, owner, non-secret infra).',
    auth: 'bearer',
    response: onboardingConfigResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'getMe',
    method: 'GET',
    path: '/api/v1/users/me',
    summary: 'The authenticated learner identity (id, name, email).',
    auth: 'bearer',
    response: meResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'askInteraction',
    method: 'POST',
    path: '/api/v1/episodes/{episodeId}/interact',
    summary: 'Ask a contextual question about an episode; queues an answer.',
    auth: 'bearer',
    request: askInteractionRequestSchema,
    response: interactionResponseSchema,
    // The route returns 201 with the created (PENDING) interaction.
    successStatuses: [201],
  },
  {
    id: 'pollInteraction',
    method: 'GET',
    path: '/api/v1/episodes/{episodeId}/interact/{interactionId}',
    summary: 'Poll an interaction until it is ANSWERED with answer text.',
    auth: 'bearer',
    response: interactionResponseSchema,
    successStatuses: [200],
  },
  {
    id: 'redeemPairingToken',
    method: 'POST',
    path: '/api/v1/auth/pair/redeem',
    summary: 'Exchange a single-use pairing token for a long-lived API key.',
    auth: 'none',
    request: redeemPairingRequestSchema,
    response: redeemPairingResponseSchema,
    successStatuses: [200],
  },
];
