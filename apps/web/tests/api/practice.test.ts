import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { PracticeCourseNotFoundError, PracticeSessionNotFoundError } = vi.hoisted(() => {
  class PracticeCourseNotFoundError extends Error {}
  class PracticeSessionNotFoundError extends Error {}
  return { PracticeCourseNotFoundError, PracticeSessionNotFoundError };
});

const mockAuthenticateRequest = vi.fn();
const mockStartPractice = vi.fn();
const mockSubmitPractice = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockLearnerVocabCount = vi.fn();
const mockLearnerGrammarCount = vi.fn();
const mockPracticeSessionFindMany = vi.fn();

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a) }));
vi.mock('@/lib/practice-service', () => ({
  startPractice: (...a: unknown[]) => mockStartPractice(...a),
  submitPractice: (...a: unknown[]) => mockSubmitPractice(...a),
  PracticeCourseNotFoundError,
  PracticeSessionNotFoundError,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
    learnerVocab: { count: (...a: unknown[]) => mockLearnerVocabCount(...a) },
    learnerGrammar: { count: (...a: unknown[]) => mockLearnerGrammarCount(...a) },
    practiceSession: { findMany: (...a: unknown[]) => mockPracticeSessionFindMany(...a) },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { POST as startPost, GET as overviewGet } from '@/app/api/courses/[courseId]/practice/route';
import { POST as submitPost } from '@/app/api/practice/[sessionId]/submit/route';

const COURSE_PARAMS = { params: Promise.resolve({ courseId: 'c1' }) };
const SESSION_PARAMS = { params: Promise.resolve({ sessionId: 'ps1' }) };

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
});

describe('POST /api/courses/[courseId]/practice', () => {
  it('starts a session and returns 201 with items (ungated — no 409)', async () => {
    mockStartPractice.mockResolvedValue({ status: 'ready', sessionId: 'ps1', kind: 'VOCAB', items: [{ id: 'v0', prompt: 'hi', options: ['a', 'b'] }] });
    const res = await startPost(jsonReq('http://localhost/api/courses/c1/practice', { kind: 'VOCAB' }), COURSE_PARAMS);
    expect(res.status).toBe(201);
    expect((await res.json()).sessionId).toBe('ps1');
  });

  it('returns 200 + unavailable when there is not enough content', async () => {
    mockStartPractice.mockResolvedValue({ status: 'unavailable', reason: 'not_enough_vocab' });
    const res = await startPost(jsonReq('http://localhost/api/courses/c1/practice', { kind: 'VOCAB' }), COURSE_PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe('not_enough_vocab');
  });

  it('400s on an invalid kind', async () => {
    const res = await startPost(jsonReq('http://localhost/api/courses/c1/practice', { kind: 'NONSENSE' }), COURSE_PARAMS);
    expect(res.status).toBe(400);
    expect(mockStartPractice).not.toHaveBeenCalled();
  });

  it('404s when the course is not the user\'s', async () => {
    mockStartPractice.mockRejectedValue(new PracticeCourseNotFoundError('nope'));
    const res = await startPost(jsonReq('http://localhost/api/courses/c1/practice', { kind: 'GRAMMAR' }), COURSE_PARAMS);
    expect(res.status).toBe(404);
  });

  it('401s without auth', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await startPost(jsonReq('http://localhost/api/courses/c1/practice', { kind: 'VOCAB' }), COURSE_PARAMS);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/practice/[sessionId]/submit', () => {
  it('grades and returns the score', async () => {
    mockSubmitPractice.mockResolvedValue({ score: 0.8, correct: 4, total: 5 });
    const res = await submitPost(
      jsonReq('http://localhost/api/practice/ps1/submit', { answers: [{ itemId: 'v0', selectedIndex: 1 }] }),
      SESSION_PARAMS,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ score: 0.8, correct: 4, total: 5 });
  });

  it('404s for an unknown / unowned session', async () => {
    mockSubmitPractice.mockRejectedValue(new PracticeSessionNotFoundError('nope'));
    const res = await submitPost(
      jsonReq('http://localhost/api/practice/ps1/submit', { answers: [] }),
      SESSION_PARAMS,
    );
    expect(res.status).toBe(404);
  });

  it('400s on a malformed body', async () => {
    const res = await submitPost(jsonReq('http://localhost/api/practice/ps1/submit', { answers: 'nope' }), SESSION_PARAMS);
    expect(res.status).toBe(400);
    expect(mockSubmitPractice).not.toHaveBeenCalled();
  });
});

describe('GET /api/courses/[courseId]/practice', () => {
  it('returns due counts + recent sessions for the owner', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: 'c1' });
    mockLearnerVocabCount.mockResolvedValueOnce(7).mockResolvedValueOnce(20); // due, then total
    mockLearnerGrammarCount.mockResolvedValue(3);
    mockPracticeSessionFindMany.mockResolvedValue([{ id: 'ps1', kind: 'VOCAB', status: 'COMPLETED', score: 0.8 }]);

    const req = new NextRequest('http://localhost/api/courses/c1/practice', { method: 'GET' });
    const res = await overviewGet(req, COURSE_PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.due).toEqual({ vocab: 7, grammar: 3 });
    expect(json.recent).toHaveLength(1);
  });

  it('404s when the course is not the user\'s', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/courses/c1/practice', { method: 'GET' });
    const res = await overviewGet(req, COURSE_PARAMS);
    expect(res.status).toBe(404);
  });
});
