import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDelete = vi.fn();
const mockGeneratePlacement = vi.fn();
const mockScorePlacement = vi.fn();
const mockPairToLangs = vi.fn();
const mockToPublic = vi.fn();
const mockCurriculumFindUnique = vi.fn();
const mockCourseUpsert = vi.fn();
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
  pairToLangs: (...args: unknown[]) => mockPairToLangs(...args),
  toPublic: (...args: unknown[]) => mockToPublic(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    curriculum: {
      findUnique: (...args: unknown[]) => mockCurriculumFindUnique(...args),
    },
    course: {
      upsert: (...args: unknown[]) => mockCourseUpsert(...args),
    },
    placementResult: {
      upsert: (...args: unknown[]) => mockPlacementResultUpsert(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from '@/app/api/placement/route';

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

function makeGetRequest(pair?: string): NextRequest {
  const url = pair
    ? `http://localhost:3000/api/placement?pair=${pair}`
    : 'http://localhost:3000/api/placement';
  return new NextRequest(url, { method: 'GET' });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/placement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 3600000 });
    mockPairToLangs.mockReturnValue({ native: 'en', target: 'de' });
    mockGeneratePlacement.mockResolvedValue({ questions: SAMPLE_QUESTIONS, provider: 'anthropic', model: 'claude-3-haiku' });
    mockToPublic.mockImplementation((q: (typeof SAMPLE_QUESTIONS)[0]) => ({
      id: q.id, cefr: q.cefr, skill: q.skill, prompt: q.prompt, options: q.options,
    }));
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(makeGetRequest('DE_FROM_EN'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid pair parameter', async () => {
    const response = await GET(makeGetRequest('INVALID_PAIR'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/pair/i);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 400 when pair is missing', async () => {
    const response = await GET(makeGetRequest());

    expect(response.status).toBe(400);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 3600000 });

    const response = await GET(makeGetRequest('DE_FROM_EN'));

    expect(response.status).toBe(429);
    expect(mockGeneratePlacement).not.toHaveBeenCalled();
  });

  it('returns public questions without correctIndex and caches the full questions', async () => {
    const response = await GET(makeGetRequest('DE_FROM_EN'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pair).toBe('DE_FROM_EN');
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
      'placement:u1:DE_FROM_EN',
      SAMPLE_QUESTIONS,
      3600,
    );
  });

  it('accepts all valid pair values', async () => {
    for (const pair of ['DE_FROM_EN', 'EN_FROM_ES', 'ES_FROM_EN']) {
      vi.clearAllMocks();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
      mockCheckRateLimit.mockResolvedValue({ allowed: true });
      mockPairToLangs.mockReturnValue({ native: 'en', target: 'de' });
      mockGeneratePlacement.mockResolvedValue({ questions: SAMPLE_QUESTIONS, provider: 'anthropic', model: 'claude-3-haiku' });
      mockToPublic.mockImplementation((q: (typeof SAMPLE_QUESTIONS)[0]) => ({
        id: q.id, cefr: q.cefr, skill: q.skill, prompt: q.prompt, options: q.options,
      }));
      mockCacheSet.mockResolvedValue(undefined);

      const response = await GET(makeGetRequest(pair));
      expect(response.status).toBe(200);
    }
  });
});

describe('POST /api/placement', () => {
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
    mockCurriculumFindUnique.mockResolvedValue({ id: 'c1', title: 'German from English' });
    mockScorePlacement.mockReturnValue(scoreOutcome);
    mockPairToLangs.mockReturnValue({ native: 'en', target: 'de' });
    mockCourseUpsert.mockResolvedValue({ id: 'course-1', pair: 'DE_FROM_EN', currentLevel: 'B1' });
    mockPlacementResultUpsert.mockResolvedValue({ courseId: 'course-1', level: 'B1' });
    mockCacheDelete.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid body (bad pair)', async () => {
    const response = await POST(makePostRequest({ pair: 'INVALID', answers }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when answers array is empty', async () => {
    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN', answers: [] }));

    expect(response.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 409 when placement session (cache) has expired', async () => {
    mockCacheGet.mockResolvedValue(null);

    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/expired/i);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when no curriculum exists for the pair', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);

    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/curriculum/i);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('grades answers, upserts course with assigned level, and returns result', async () => {
    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.courseId).toBe('course-1');
    expect(body.level).toBe('B1');
    expect(body.scoreBySkill).toEqual({ grammar: 1.0, vocab: 1.0 });

    expect(mockScorePlacement).toHaveBeenCalledWith(SAMPLE_QUESTIONS, answers);
  });

  it('upserts course with the scored CEFR level', async () => {
    await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));

    expect(mockCourseUpsert).toHaveBeenCalledWith({
      where: { userId_pair: { userId: 'u1', pair: 'DE_FROM_EN' } },
      create: expect.objectContaining({
        userId: 'u1',
        pair: 'DE_FROM_EN',
        curriculumId: 'c1',
        currentLevel: 'B1',
        startLevel: 'B1',
      }),
      update: expect.objectContaining({
        currentLevel: 'B1',
        startLevel: 'B1',
      }),
    });
  });

  it('upserts placement result for the course', async () => {
    await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));

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
    await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));

    expect(mockCacheDelete).toHaveBeenCalledWith('placement:u1:DE_FROM_EN');
  });

  it('accepts A1 level outcomes (lowest possible result)', async () => {
    mockScorePlacement.mockReturnValue({
      ...scoreOutcome,
      level: 'A1',
      scoreByBand: { A1: 0.0 },
      scoreBySkill: { grammar: 0.0 },
    });
    mockCourseUpsert.mockResolvedValue({ id: 'course-1', pair: 'DE_FROM_EN', currentLevel: 'A1' });

    const response = await POST(makePostRequest({ pair: 'DE_FROM_EN', answers }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.level).toBe('A1');
  });
});
