import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockGetCourseNote = vi.fn();
const mockSetCourseNote = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) } },
}));
vi.mock('@/lib/course-notes', () => ({
  getCourseNote: (...a: unknown[]) => mockGetCourseNote(...a),
  setCourseNote: (...a: unknown[]) => mockSetCourseNote(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { GET, PUT } from '@/app/api/courses/[courseId]/notes/route';

const PARAMS = { params: Promise.resolve({ courseId: 'course-1' }) };

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/courses/course-1/notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/courses/course-1/notes', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  mockCourseFindFirst.mockResolvedValue({ id: 'course-1' });
});

describe('GET /api/courses/[courseId]/notes', () => {
  it('returns the note body for the owner', async () => {
    mockGetCourseNote.mockResolvedValue('travel to Italy');
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ body: 'travel to Italy' });
  });

  it('401s without auth', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(401);
  });

  it('404s when the course is not the user\'s', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(404);
    expect(mockGetCourseNote).not.toHaveBeenCalled();
  });
});

describe('PUT /api/courses/[courseId]/notes', () => {
  it('saves a valid note for the owner', async () => {
    mockGetCourseNote.mockResolvedValue('focus on speaking');
    const res = await PUT(putReq({ body: 'focus on speaking' }), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSetCourseNote).toHaveBeenCalledWith('course-1', 'focus on speaking');
    expect(await res.json()).toEqual({ body: 'focus on speaking' });
  });

  it('400s on an invalid body', async () => {
    const res = await PUT(putReq({ body: 123 }), PARAMS);
    expect(res.status).toBe(400);
    expect(mockSetCourseNote).not.toHaveBeenCalled();
  });

  it('404s when the course is not the user\'s', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const res = await PUT(putReq({ body: 'x' }), PARAMS);
    expect(res.status).toBe(404);
    expect(mockSetCourseNote).not.toHaveBeenCalled();
  });
});
