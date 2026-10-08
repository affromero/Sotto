import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockAuthenticateRequest,
  mockCourseFindFirst,
  mockRequestPreparation,
  mockReadPreparation,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockRequestPreparation: vi.fn(),
  mockReadPreparation: vi.fn(),
}));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: mockAuthenticateRequest }));
vi.mock('@/lib/prisma', () => ({ prisma: { course: { findFirst: mockCourseFindFirst } } }));
vi.mock('@/lib/classes/preparation', () => ({
  requestClassPreparation: mockRequestPreparation,
  readClassPreparation: mockReadPreparation,
}));

import { POST as POSTNextClass } from '@/app/api/v1/courses/[courseId]/next-class/route';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import { ProviderCreditsExhaustedError } from '@/lib/providers/shared/speech-availability';

function makeRequest(url: string, method: string): NextRequest {
  return new NextRequest(url, { method });
}
function courseParams(courseId: string) {
  return { params: Promise.resolve({ courseId }) };
}

// ---- POST /api/v1/courses/[courseId]/next-class ----

describe('POST /api/v1/courses/[courseId]/next-class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCourseFindFirst.mockResolvedValue({ id: 'course-1' });
    mockRequestPreparation.mockResolvedValue({ id: 'operation-1', status: 'QUEUED' });
    mockReadPreparation.mockResolvedValue({
      id: 'operation-1',
      status: 'COMPLETED',
      result: 'created',
      classId: 'class-new',
    });
  });

  const next = (suffix = '') =>
    POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class' + suffix, 'POST'),
      courseParams('course-1')
    );

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    expect((await next()).status).toBe(401);
  });

  it('alerts an exhausted-credit learner before accepting background generation', async () => {
    mockRequestPreparation.mockRejectedValue(new ProviderCreditsExhaustedError('cartesia'));
    const response = await next('?background=1');
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      code: 'PROVIDER_CREDITS_EXHAUSTED',
      error: expect.stringContaining('explicitly disable audio'),
    });
  });

  it('returns the persisted class result to a synchronous client', async () => {
    const response = await next();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ classId: 'class-new' });
  });

  it('returns the durable operation identity for background preparation', async () => {
    const response = await next('?background=1');
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      started: true,
      operationId: 'operation-1',
      status: 'QUEUED',
    });
  });

  it('honors Prefer respond-async with the same durable identity', async () => {
    const request = makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST');
    request.headers.set('Prefer', 'respond-async');
    const response = await POSTNextClass(request, courseParams('course-1'));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ operationId: 'operation-1' });
  });

  it.each(['', '?background=1'])(
    'returns 404 for missing or inaccessible courses: %s',
    async (suffix) => {
      mockCourseFindFirst.mockResolvedValue(null);
      expect((await next(suffix)).status).toBe(404);
    }
  );

  it('returns the existing class when the persisted result is gated', async () => {
    mockReadPreparation.mockResolvedValue({
      id: 'operation-1',
      status: 'COMPLETED',
      result: 'gated',
      classId: 'class-existing',
    });
    const response = await next();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ activeClassId: 'class-existing' });
  });

  it('reports completed curriculum from the persisted result', async () => {
    mockReadPreparation.mockResolvedValue({
      id: 'operation-1',
      status: 'COMPLETED',
      result: 'done',
    });
    const response = await next();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });
  });

  it.each(['CANCELLED', 'CANCELLING'])('reports cancellation while waiting: %s', async (status) => {
    mockReadPreparation.mockResolvedValue({ id: 'operation-1', status });
    const response = await next();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ cancelled: true });
  });

  it('does not substitute a newer operation while a synchronous client waits', async () => {
    mockReadPreparation.mockResolvedValue({
      id: 'operation-2',
      status: 'COMPLETED',
      classId: 'wrong-class',
    });
    const response = await next();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Preparation changed.' });
  });

  it.each([
    ['FAILED', 502],
    ['UNRESOLVED', 409],
  ])('reports durable terminal failure %s', async (status, expected) => {
    mockReadPreparation.mockResolvedValue({ id: 'operation-1', status });
    expect((await next()).status).toBe(expected);
  });

  it('keeps an unreadable source actionable for synchronous clients', async () => {
    mockReadPreparation.mockResolvedValue({
      id: 'operation-1',
      status: 'FAILED',
      failure: 'source_unreadable',
    });
    const response = await next();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/another source/i),
    });
  });

  it('rejects conflicting admission before acknowledging background work', async () => {
    mockRequestPreparation.mockRejectedValue(
      new PreparationConflictError('An existing preparation needs recovery.')
    );
    const response = await next('?background=1');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'An existing preparation needs recovery.',
    });
  });

  it('does not acknowledge failed persistence or expose its diagnostics', async () => {
    mockRequestPreparation.mockRejectedValue(new Error('private database credentials'));
    const response = await next('?background=1');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private');
  });
});
