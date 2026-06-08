import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockPairToLangs = vi.fn();
const mockCurriculumFindUnique = vi.fn();
const mockCourseFindMany = vi.fn();
const mockCourseUpsert = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/placement-test', () => ({
  pairToLangs: (...args: unknown[]) => mockPairToLangs(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    curriculum: {
      findUnique: (...args: unknown[]) => mockCurriculumFindUnique(...args),
    },
    course: {
      findMany: (...args: unknown[]) => mockCourseFindMany(...args),
      upsert: (...args: unknown[]) => mockCourseUpsert(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from '@/app/api/courses/route';

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/courses', { method: 'GET' });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SAMPLE_COURSES = [
  {
    id: 'course-1',
    pair: 'DE_FROM_EN',
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
    pair: 'ES_FROM_EN',
    nativeLang: 'en',
    targetLang: 'es',
    currentLevel: 'B1',
    startLevel: 'A2',
    activeClassId: 'class-7',
    curriculum: { title: 'Spanish from English' },
    placement: { level: 'B1', createdAt: new Date('2026-01-01T00:00:00Z') },
  },
];

describe('GET /api/courses', () => {
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

describe('POST /api/courses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCurriculumFindUnique.mockResolvedValue({ id: 'c1', title: 'German from English' });
    mockPairToLangs.mockReturnValue({ native: 'en', target: 'de' });
    mockCourseUpsert.mockResolvedValue({
      id: 'course-new',
      pair: 'DE_FROM_EN',
      nativeLang: 'en',
      targetLang: 'de',
      currentLevel: null,
      startLevel: null,
      curriculumId: 'c1',
      userId: 'u1',
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid pair value', async () => {
    const response = await POST(makePostRequest({ pair: 'INVALID_PAIR' }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when pair is missing', async () => {
    const response = await POST(makePostRequest({}));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when no curriculum exists for the pair', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);

    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/curriculum/i);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('creates an A1 course (skip-placement) and returns 201', async () => {
    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.course.id).toBe('course-new');
    expect(body.course.pair).toBe('DE_FROM_EN');
  });

  it('upserts the course with the correct fields', async () => {
    await POST(makePostRequest({ pair: 'DE_FROM_EN' }));

    expect(mockCourseUpsert).toHaveBeenCalledWith({
      where: { userId_pair: { userId: 'u1', pair: 'DE_FROM_EN' } },
      create: expect.objectContaining({
        userId: 'u1',
        pair: 'DE_FROM_EN',
        nativeLang: 'en',
        targetLang: 'de',
        curriculumId: 'c1',
      }),
      update: {},
    });
  });

  it('accepts all valid pair values', async () => {
    for (const pair of ['DE_FROM_EN', 'EN_FROM_ES', 'ES_FROM_EN']) {
      vi.clearAllMocks();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
      mockCurriculumFindUnique.mockResolvedValue({ id: 'c1' });
      mockPairToLangs.mockReturnValue({ native: 'en', target: 'de' });
      mockCourseUpsert.mockResolvedValue({ id: 'course-x', pair });

      const response = await POST(makePostRequest({ pair }));
      expect(response.status).toBe(201);
    }
  });

  it('does not set a currentLevel (A1 course starts without a placed level)', async () => {
    await POST(makePostRequest({ pair: 'DE_FROM_EN' }));

    const call = mockCourseUpsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('currentLevel');
    expect(call.create).not.toHaveProperty('startLevel');
  });
});
