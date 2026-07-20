/**
 * POST /api/v1/exams/[examId]/submit. Adversarial: 401 unauth, 400 bad body, 404
 * missing/non-owner exam, 200 with the scored result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockScoreExam = vi.fn();

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/mock-exam-scoring', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/mock-exam-scoring')>('@/lib/mock-exam-scoring');
  return { ...actual, scoreExam: (...a: unknown[]) => mockScoreExam(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST } from '@/app/api/v1/exams/[examId]/submit/route';
import { ExamNotFoundError } from '@/lib/mock-exam-scoring';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/exams/exam1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const PARAMS = { params: Promise.resolve({ examId: 'exam1' }) };
const VALID = { answers: [{ questionId: 'q1', selectedIndex: 0 }] };

describe('POST /api/v1/exams/[examId]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'u1' });
    mockScoreExam.mockResolvedValue({
      overallScore: 0.65,
      band: 'B1 pass (mock)',
      sections: [],
      feedback: 'ok',
    });
  });

  it('rejects unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req(VALID), PARAMS);
    expect(res.status).toBe(401);
    expect(mockScoreExam).not.toHaveBeenCalled();
  });

  it('rejects a malformed answers payload', async () => {
    const res = await POST(req({ answers: [{ questionId: 'q1' }] }), PARAMS);
    expect(res.status).toBe(400);
  });

  it('scores the exam and returns the result', async () => {
    const res = await POST(req(VALID), PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).band).toBe('B1 pass (mock)');
    expect(mockScoreExam).toHaveBeenCalledWith('exam1', 'u1', VALID.answers);
  });

  it('returns 404 for a missing or non-owner exam', async () => {
    mockScoreExam.mockRejectedValue(new ExamNotFoundError('Exam not found'));
    const res = await POST(req(VALID), PARAMS);
    expect(res.status).toBe(404);
  });
});
