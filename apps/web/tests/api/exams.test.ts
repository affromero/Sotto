/**
 * POST /api/exams + GET /api/exams/[examId]. Adversarial: 401 unauth, 400 bad
 * body, 404 non-owner course / missing exam, 201 on create, 500 on the unexpected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCreate = vi.fn();
const mockGet = vi.fn();

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/mock-exam-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mock-exam-service')>('@/lib/mock-exam-service');
  return {
    ...actual,
    createMockExam: (...a: unknown[]) => mockCreate(...a),
    getExamForUser: (...a: unknown[]) => mockGet(...a),
  };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST } from '@/app/api/exams/route';
import { GET } from '@/app/api/exams/[examId]/route';
import { ExamCourseNotFoundError } from '@/lib/mock-exam-service';

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/exams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/exams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'u1' });
    mockCreate.mockResolvedValue('exam1');
  });

  it('rejects unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(postReq({ courseId: 'c1' }));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a missing courseId', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it('creates an exam and returns its id', async () => {
    const res = await POST(postReq({ courseId: 'c1', level: 'B2' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ examId: 'exam1' });
    expect(mockCreate).toHaveBeenCalledWith('c1', 'u1', 'B2');
  });

  it('returns 404 for a course the caller does not own', async () => {
    mockCreate.mockRejectedValue(new ExamCourseNotFoundError('Course not found'));
    const res = await POST(postReq({ courseId: 'c1' }));
    expect(res.status).toBe(404);
  });

  it('returns 500 on an unexpected failure', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const res = await POST(postReq({ courseId: 'c1' }));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/exams/[examId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'u1' });
    mockGet.mockResolvedValue({ id: 'exam1', status: 'READY', sections: [] });
  });

  function getReq(): NextRequest {
    return new NextRequest('http://localhost:3000/api/exams/exam1');
  }

  it('rejects unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(getReq(), { params: Promise.resolve({ examId: 'exam1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the exam is not found for the caller', async () => {
    mockGet.mockResolvedValue(null);
    const res = await GET(getReq(), { params: Promise.resolve({ examId: 'exam1' }) });
    expect(res.status).toBe(404);
  });

  it('returns the exam for its owner', async () => {
    const res = await GET(getReq(), { params: Promise.resolve({ examId: 'exam1' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('exam1');
  });
});
