/**
 * GET/PATCH /api/courses/[courseId]/pedagogy. Adversarial: 401 unauth, 400 bad
 * value, 404 non-owner course, 200 read/update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockCourseUpdate = vi.fn();

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      findFirst: (...a: unknown[]) => mockCourseFindFirst(...a),
      update: (...a: unknown[]) => mockCourseUpdate(...a),
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET, PATCH } from '@/app/api/courses/[courseId]/pedagogy/route';

const PARAMS = { params: Promise.resolve({ courseId: 'c1' }) };

function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/courses/c1/pedagogy', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/courses/c1/pedagogy');
}

describe('course pedagogy route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'u1' });
    mockCourseFindFirst.mockResolvedValue({ id: 'c1', pedagogy: 'BALANCED' });
    mockCourseUpdate.mockResolvedValue({});
  });

  it('GET returns the current pedagogy', async () => {
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pedagogy: 'BALANCED' });
  });

  it('GET rejects an unauthenticated request', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET(getReq(), PARAMS)).status).toBe(401);
  });

  it('PATCH switches the pedagogy for an owned course', async () => {
    const res = await PATCH(patchReq({ pedagogy: 'IMMERSION' }), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pedagogy: 'IMMERSION' });
    expect(mockCourseUpdate).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { pedagogy: 'IMMERSION' } });
  });

  it('PATCH rejects an invalid pedagogy value', async () => {
    const res = await PATCH(patchReq({ pedagogy: 'YOLO' }), PARAMS);
    expect(res.status).toBe(400);
    expect(mockCourseUpdate).not.toHaveBeenCalled();
  });

  it('PATCH returns 404 for a course the caller does not own', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ pedagogy: 'GRAMMAR' }), PARAMS);
    expect(res.status).toBe(404);
    expect(mockCourseUpdate).not.toHaveBeenCalled();
  });
});
