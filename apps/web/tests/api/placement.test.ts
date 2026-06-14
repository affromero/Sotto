import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDelete = vi.fn();
const mockGeneratePlacement = vi.fn();
const mockScorePlacement = vi.fn();
const mockGetOrCreateCurriculum = vi.fn();
const mockToPublic = vi.fn();
const mockCourseUpsert = vi.fn();
const mockCourseFindUnique = vi.fn();
const mockPlacementResultUpsert = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
    delete: (...args: unknown[]) => mockCacheDelete(...args),
  },
}));

vi.mock('@/lib/placement-test', () => ({
  generatePlacement: (...args: unknown[]) => mockGeneratePlacement(...args),
  scorePlacement: (...args: unknown[]) => mockScorePlacement(...args),
  toPublic: (...args: unknown[]) => mockToPublic(...args),
}));

vi.mock('@/lib/curriculum-generator', () => ({
  getOrCreateCurriculum: (...args: unknown[]) => mockGetOrCreateCurriculum(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      upsert: (...args: unknown[]) => mockCourseUpsert(...args),
      findUnique: (...args: unknown[]) => mockCourseFindUnique(...args),
    },
    placementResult: {
      upsert: (...args: unknown[]) => mockPlacementResultUpsert(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from '@/app/api/v1/placement/route';

const SAMPLE_QUESTIONS = [
  {
    id: 'pq_0',
    cefr: 'A1',
    skill: 'grammar',
    prompt: 'Choose the correct article: ___ apple.',
    options: ['a', 'an', 'the', 'no article'],
    correctIndex: 1,
    explanation: '"An" before vowel sound.',
  },
  {
    id: 'pq_1',
    cefr: 'B1',
    skill: 'vocab',
    prompt: 'What is a synonym for "happy"?',
    options: ['sad', 'angry', 'joyful', 'tired'],
    correctIndex: 2,
    explanation: '"Joyful" means happy.',
  },
];

function makeGetRequest(params?: { native?: string; target?: string }): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/placement');
  if (params?.native) url.searchParams.set('native', params.native);
  if (params?.target) url.searchParams.set('target', params.target);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/placement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/v1/placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 3600000 });
    mockGeneratePlacement.mockResolvedValue({ questions: SAMPLE_QUESTIONS, provider: 'anthropic', model: 'claude-3-haiku' });
    mockToPublic.mockImplementation((q: (typeof SAMPLE_QUESTIONS)[0]) => ({
      id: q.id, cefr: q.cefr, skill: q.skill, prompt: q.prompt, options: q.options,
    }));
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(makeGetRequest({ native: 'en', target: 'de' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid native parameter (too long)', async () => {
    const response = await GET(makeGetRequest({ native: 'invalid', target: 'de' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/native|target/i);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 400 when native is missing', async () => {
    const response = await GET(makeGetRequest({ target: 'de' }));

    expect(response.status).toBe(400);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 400 when target is missing', async () => {
    const response = await GET(makeGetRequest({ native: 'en' }));

    expect(response.status).toBe(400);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 400 when both params are missing', async () => {
    const response = await GET(makeGetRequest());

    expect(response.status).toBe(400);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 400 when native and target are the same language', async () => {
    const response = await GET(makeGetRequest({ native: 'en', target: 'en' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/differ/i);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 3600000 });

    const response = await GET(makeGetRequest({ native: 'en', target: 'de' }));

    expect(response.status).toBe(429);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns public questions without correctIndex and caches the full questions', async () => {
    const response = await GET(makeGetRequest({ native: 'en', target: 'de' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.native).toBe('en');
    expect(body.target).toBe('de');
    expect(body.questions).toHaveLength(2);

    // Public view must not expose correctIndex
    for (const q of body.questions) {
      expect(q).not.toHaveProperty('correctIndex');
      expect(q).not.toHaveProperty('explanation');
      expect(q).toHaveProperty('id');
      expect(q).toHaveProperty('options');
    }

    // Full questions (with correctIndex) should be cached for grading
    expect(mockCacheSet).toHaveBeenCalledWith(
      'placement:u1:en_de',
      SAMPLE_QUESTIONS,
      3600,
    );
  });

  it('accepts valid two-letter ISO code pairs', async () => {
    for (const [native, target] of [['en', 'de'], ['en', 'es'], ['es', 'en']]) {
      vi.clearAllMocks();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
      mockCheckRateLimit.mockResolvedValue({ allowed: true });
      mockGeneratePlacement.mockResolvedValue({ questions: SAMPLE_QUESTIONS, provider: 'anthropic', model: 'claude-3-haiku' });
      mockToPublic.mockImplementation((q: (typeof SAMPLE_QUESTIONS)[0]) => ({
        id: q.id, cefr: q.cefr, skill: q.skill, prompt: q.prompt, options: q.options,
      }));
      mockCacheSet.mockResolvedValue(undefined);

      const response = await GET(makeGetRequest({ native, target }));
      expect(response.status).toBe(200);
    }
  });
});

describe('POST /api/v1/placement', () => {
  const answers = [
    { id: 'pq_0', selectedIndex: 1 },
    { id: 'pq_1', selectedIndex: 2 },
  ];

  const scoreOutcome = {
    level: 'B1' as const,
    scoreByBand: { A1: 1.0, B1: 1.0 },
    scoreBySkill: { grammar: 1.0, vocab: 1.0 },
    responses: [
      { id: 'pq_0', cefr: 'A1', skill: 'grammar', selectedIndex: 1, correct: true },
      { id: 'pq_1', cefr: 'B1', skill: 'vocab', selectedIndex: 2, correct: true },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCacheGet.mockResolvedValue(SAMPLE_QUESTIONS);
    mockGetOrCreateCurriculum.mockResolvedValue({ id: 'c1' });
    mockScorePlacement.mockReturnValue(scoreOutcome);
    // Default: no existing course (first placement). Re-take tests override this.
    mockCourseFindUnique.mockResolvedValue(null);
    mockCourseUpsert.mockResolvedValue({ id: 'course-1', nativeLang: 'en', targetLang: 'de', currentLevel: 'B1' });
    mockPlacementResultUpsert.mockResolvedValue({ courseId: 'course-1', level: 'B1' });
    mockCacheDelete.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(makePostRequest({ native: 'en', target: 'de', answers }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid body (bad native code)', async () => {
    const response = await POST(makePostRequest({ native: 'invalid', target: 'de', answers }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when answers array is empty', async () => {
    const response = await POST(makePostRequest({ native: 'en', target: 'de', answers: [] }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when native is missing', async () => {
    const response = await POST(makePostRequest({ target: 'de', answers }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when native and target are the same language', async () => {
    const response = await POST(makePostRequest({ native: 'en', target: 'en', answers }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/differ/i);
    expect(mockGetOrCreateCurriculum).not.toHaveBeenCalled();
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 409 when placement session (cache) has expired', async () => {
    mockCacheGet.mockResolvedValue(null);

    const response = await POST(makePostRequest({ native: 'en', target: 'de', answers }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/expired/i);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('calls getOrCreateCurriculum to resolve the curriculum', async () => {
    await POST(makePostRequest({ native: 'en', target: 'de', answers }));

    expect(mockGetOrCreateCurriculum).toHaveBeenCalledWith('u1', 'en', 'de');
  });

  it('grades answers, upserts course with assigned level, and returns result', async () => {
    const response = await POST(makePostRequest({ native: 'en', target: 'de', answers }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.courseId).toBe('course-1');
    expect(body.level).toBe('B1');
    expect(body.scoreBySkill).toEqual({ grammar: 1.0, vocab: 1.0 });

    expect(mockScorePlacement).toHaveBeenCalledWith(SAMPLE_QUESTIONS, answers);
  });

  it('first placement creates the course with start + current set to the scored level', async () => {
    mockCourseFindUnique.mockResolvedValue(null);

    await POST(makePostRequest({ native: 'en', target: 'de', answers }));

    expect(mockCourseUpsert).toHaveBeenCalledWith({
      where: { userId_nativeLang_targetLang: { userId: 'u1', nativeLang: 'en', targetLang: 'de' } },
      create: expect.objectContaining({
        userId: 'u1',
        nativeLang: 'en',
        targetLang: 'de',
        curriculumId: 'c1',
        currentLevel: 'B1',
        startLevel: 'B1',
      }),
      update: { currentLevel: 'B1' },
    });
    // The update branch must NOT reset startLevel on a re-take.
    expect(mockCourseUpsert.mock.calls[0][0].update).not.toHaveProperty('startLevel');
  });

  it('re-taking placement keeps startLevel and never lowers currentLevel', async () => {
    // Learner already progressed to B2; a new (lower) result of A2 must not
    // move them backward, and startLevel is never rewritten.
    mockCourseFindUnique.mockResolvedValue({ currentLevel: 'B2' });
    mockScorePlacement.mockReturnValue({ ...scoreOutcome, level: 'A2' });

    await POST(makePostRequest({ native: 'en', target: 'de', answers }));

    const call = mockCourseUpsert.mock.calls[0][0];
    expect(call.update).toEqual({ currentLevel: 'B2' });
    expect(call.update).not.toHaveProperty('startLevel');
  });

  it('re-taking placement raises currentLevel when the new result is higher', async () => {
    mockCourseFindUnique.mockResolvedValue({ currentLevel: 'A1' });
    mockScorePlacement.mockReturnValue({ ...scoreOutcome, level: 'B1' });

    await POST(makePostRequest({ native: 'en', target: 'de', answers }));

    expect(mockCourseUpsert.mock.calls[0][0].update).toEqual({ currentLevel: 'B1' });
  });

  it('upserts placement result for the course', async () => {
    await POST(makePostRequest({ native: 'en', target: 'de', answers }));

    expect(mockPlacementResultUpsert).toHaveBeenCalledWith({
      where: { courseId: 'course-1' },
      create: expect.objectContaining({
        courseId: 'course-1',
        level: 'B1',
        scoreBySkill: { grammar: 1.0, vocab: 1.0 },
      }),
      update: expect.objectContaining({
        level: 'B1',
        scoreBySkill: { grammar: 1.0, vocab: 1.0 },
      }),
    });
  });

  it('deletes the cached session after successful grading', async () => {
    await POST(makePostRequest({ native: 'en', target: 'de', answers }));

    expect(mockCacheDelete).toHaveBeenCalledWith('placement:u1:en_de');
  });

  it('accepts A1 level outcomes (lowest possible result)', async () => {
    mockScorePlacement.mockReturnValue({
      ...scoreOutcome,
      level: 'A1',
      scoreByBand: { A1: 0.0 },
      scoreBySkill: { grammar: 0.0 },
    });
    mockCourseUpsert.mockResolvedValue({ id: 'course-1', nativeLang: 'en', targetLang: 'de', currentLevel: 'A1' });

    const response = await POST(makePostRequest({ native: 'en', target: 'de', answers }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.level).toBe('A1');
  });
});
