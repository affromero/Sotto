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
}

export const endpoints: EndpointDef[] = [
  {
    id: 'health',
    method: 'GET',
    path: '/api/v1/health',
    summary: 'Liveness and dependency health for the instance.',
    auth: 'none',
    response: healthResponseSchema,
  },
  {
    id: 'listCourses',
    method: 'GET',
    path: '/api/v1/courses',
    summary: "List the authenticated learner's courses.",
    auth: 'bearer',
    response: coursesListResponseSchema,
  },
  {
    id: 'getPracticeOverview',
    method: 'GET',
    path: '/api/v1/courses/{courseId}/practice',
    summary: 'Due counts per skill, total vocab, and recent practice sessions.',
    auth: 'bearer',
    response: practiceOverviewResponseSchema,
  },
  {
    id: 'startPractice',
    method: 'POST',
    path: '/api/v1/courses/{courseId}/practice',
    summary: 'Start an ungated, single-skill practice session.',
    auth: 'bearer',
    request: startPracticeRequestSchema,
    response: startPracticeResponseSchema,
  },
  {
    id: 'submitPractice',
    method: 'POST',
    path: '/api/v1/practice/{sessionId}/submit',
    summary: 'Grade a practice session and update spaced-repetition state.',
    auth: 'bearer',
    request: submitPracticeRequestSchema,
    response: submitPracticeResponseSchema,
  },
  {
    id: 'redeemPairingToken',
    method: 'POST',
    path: '/api/v1/auth/pair/redeem',
    summary: 'Exchange a single-use pairing token for a long-lived API key.',
    auth: 'none',
    request: redeemPairingRequestSchema,
    response: redeemPairingResponseSchema,
  },
];
