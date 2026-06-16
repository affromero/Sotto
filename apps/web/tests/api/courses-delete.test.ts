import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockCacheDelete = vi.fn();
const mockDeleteCourseCompletely = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) } },
}));
vi.mock('@/lib/redis', () => ({
  cache: { delete: (...a: unknown[]) => mockCacheDelete(...a) },
}));
vi.mock('@/lib/course-deletion', () => ({
  deleteCourseCompletely: (...a: unknown[]) => mockDeleteCourseCompletely(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '@/app/api/v1/courses/[courseId]/route';

function del(body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/courses/course-1', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = (courseId = 'course-1') => ({ params: Promise.resolve({ courseId }) });

describe('DELETE /api/v1/courses/[courseId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCourseFindFirst.mockResolvedValue({ id: 'course-1', nativeLang: 'en', targetLang: 'de' });
    mockCacheDelete.mockResolvedValue(undefined);
    mockDeleteCourseCompletely.mockResolvedValue({
      episodesDeleted: 2,
      filesAttempted: 5,
      filesDeleted: 5,
      filesFailed: 0,
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await DELETE(del({ confirm: 'de' }), params());
    expect(res.status).toBe(401);
    expect(mockDeleteCourseCompletely).not.toHaveBeenCalled();
  });

  it('returns 404 for a course the learner does not own', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const res = await DELETE(del({ confirm: 'de' }), params());
    expect(res.status).toBe(404);
    expect(mockDeleteCourseCompletely).not.toHaveBeenCalled();
  });

  it('requires a confirmation body', async () => {
    const res = await DELETE(del(), params());
    expect(res.status).toBe(400);
    expect(mockDeleteCourseCompletely).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that does not match the target language', async () => {
    const res = await DELETE(del({ confirm: 'es' }), params());
    expect(res.status).toBe(400);
    expect(mockDeleteCourseCompletely).not.toHaveBeenCalled();
  });

  it('deletes everything and clears both pair caches on a matching confirmation', async () => {
    const res = await DELETE(del({ confirm: 'de' }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, episodesDeleted: 2 });

    expect(mockDeleteCourseCompletely).toHaveBeenCalledWith('course-1');
    expect(mockCacheDelete).toHaveBeenCalledWith('placement:u1:en_de');
    expect(mockCacheDelete).toHaveBeenCalledWith('placement-notes:u1:en_de');
  });
});
