// The contract registry: a flat list of the /api/v1 endpoints the terminal
// client (and the Rust codegen phase) target. Each entry pairs an HTTP method +
// path with its Zod request/response schemas so a single source generates both
// the OpenAPI document and any client-side validation.
import { z } from 'zod';
import {
  coursesListResponseSchema,
  episodeDetailResponseSchema,
  healthResponseSchema,
  practiceOverviewResponseSchema,
  redeemPairingRequestSchema,
  redeemPairingResponseSchema,
  speakingPollResponseSchema,
  startPracticeRequestSchema,
  startPracticeResponseSchema,
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
  response: z.ZodType;
  // Query-string parameters (path params are derived from the path template).
  query?: QueryParamDef[];
  // HTTP statuses the route can return with the response body. The same response
  // schema is emitted for each (verified against the route handlers). Defaults to
  // [200] when omitted.
  successStatuses?: number[];
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
