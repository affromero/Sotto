// The contract registry: a flat list of the /api/v1 endpoints the terminal
// client (and the Rust codegen phase) target. Each entry pairs an HTTP method +
// path with its Zod request/response schemas so a single source generates both
// the OpenAPI document and any client-side validation.
import { z } from 'zod';
import {
  coursesListResponseSchema,
  healthResponseSchema,
  practiceOverviewResponseSchema,
  redeemPairingRequestSchema,
  redeemPairingResponseSchema,
  startPracticeRequestSchema,
  startPracticeResponseSchema,
  submitPracticeRequestSchema,
  submitPracticeResponseSchema,
} from './schemas';

export interface EndpointDef {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  auth: 'bearer' | 'none';
  request?: z.ZodType;
  response: z.ZodType;
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
