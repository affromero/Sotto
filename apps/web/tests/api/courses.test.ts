import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockGetOrCreateCurriculum = vi.fn();
const mockCourseFindMany = vi.fn();
const mockCourseUpsert = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/curriculum-generator', () => ({
  getOrCreateCurriculum: (...args: unknown[]) => mockGetOrCreateCurriculum(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      findMany: (...args: unknown[]) => mockCourseFindMany(...args),
      upsert: (...args: unknown[]) => mockCourseUpsert(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from '@/app/api/v1/courses/route';

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/courses', { method: 'GET' });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SAMPLE_COURSES = [
  {
    id: 'course-1',
    nativeLang: 'en',
    targetLang: 'de',
    currentLevel: 'A1',
    startLevel: 'A1',
    activeClassId: null,
    curriculum: { title: 'German from English' },
    placement: null,
  },
  {
    id: 'course-2',
    nativeLang: 'en',
    targetLang: 'es',
    currentLevel: 'B1',
    startLevel: 'A2',
    activeClassId: 'class-7',
    curriculum: { title: 'Spanish from English' },
    placement: { level: 'B1', createdAt: new Date('2026-01-01T00:00:00Z') },
  },
];

describe('GET /api/v1/courses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCourseFindMany.mockResolvedValue(SAMPLE_COURSES);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockCourseFindMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when the user has no courses', async () => {
    mockCourseFindMany.mockResolvedValue([]);

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.courses).toEqual([]);
  });

  it('returns all courses with their curriculum and placement data', async () => {
    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.courses).toHaveLength(2);
    expect(body.courses[0].id).toBe('course-1');
    expect(body.courses[0].curriculum).toEqual({ title: 'German from English' });
    expect(body.courses[0].placement).toBeNull();
    expect(body.courses[1].placement).toMatchObject({ level: 'B1' });
  });

  it('queries only the signed-in user\'s courses', async () => {
    await GET(makeGetRequest());

    expect(mockCourseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
      }),
    );
  });
});

describe('POST /api/v1/courses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockGetOrCreateCurriculum.mockResolvedValue({ id: 'cur-1' });
    mockCourseUpsert.mockResolvedValue({
      id: 'course-new',
      nativeLang: 'en',
      targetLang: 'de',
      currentLevel: null,
      startLevel: null,
      curriculumId: 'cur-1',
      userId: 'u1',
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(makePostRequest({ native: 'en', target: 'de' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when native and target are the same language', async () => {
    const response = await POST(makePostRequest({ native: 'en', target: 'en' }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 for missing native field', async () => {
    const response = await POST(makePostRequest({ target: 'de' }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 for missing target field', async () => {
    const response = await POST(makePostRequest({ native: 'en' }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is empty', async () => {
    const response = await POST(makePostRequest({}));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('creates a course and returns 201', async () => {
    const response = await POST(makePostRequest({ native: 'en', target: 'de' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.course.id).toBe('course-new');
    expect(body.course.nativeLang).toBe('en');
    expect(body.course.targetLang).toBe('de');
  });

  it('calls getOrCreateCurriculum with userId, native, and target', async () => {
    await POST(makePostRequest({ native: 'en', target: 'de' }));

    expect(mockGetOrCreateCurriculum).toHaveBeenCalledWith('u1', 'en', 'de');
  });

  it('upserts the course with userId_nativeLang_targetLang composite key', async () => {
    await POST(makePostRequest({ native: 'en', target: 'de' }));

    expect(mockCourseUpsert).toHaveBeenCalledWith({
      where: { userId_nativeLang_targetLang: { userId: 'u1', nativeLang: 'en', targetLang: 'de' } },
      create: expect.objectContaining({
        userId: 'u1',
        nativeLang: 'en',
        targetLang: 'de',
        curriculumId: 'cur-1',
        placementSource: 'MANUAL',
      }),
      update: {},
    });
  });

  it('accepts valid two-letter ISO code pairs', async () => {
    for (const [native, target] of [['en', 'de'], ['en', 'es'], ['es', 'en']]) {
      vi.clearAllMocks();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
      mockGetOrCreateCurriculum.mockResolvedValue({ id: 'cur-1' });
      mockCourseUpsert.mockResolvedValue({ id: 'course-x', nativeLang: native, targetLang: target });

      const response = await POST(makePostRequest({ native, target }));
      expect(response.status).toBe(201);
    }
  });

  it('does not set a currentLevel on create (A1 course starts without a placed level)', async () => {
    await POST(makePostRequest({ native: 'en', target: 'de' }));

    const call = mockCourseUpsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('currentLevel');
    expect(call.create).not.toHaveProperty('startLevel');
  });
});
