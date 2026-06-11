import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockGradeWriting = vi.fn();
const mockCourseClassFindFirst = vi.fn();
const mockWritingPromptFindFirst = vi.fn();
const mockWritingResponseFindFirst = vi.fn();
const mockWritingResponseCreate = vi.fn();
const mockWritingResponseUpdate = vi.fn();

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a) }));
vi.mock('@/lib/writing-grader', () => ({ gradeWriting: (...a: unknown[]) => mockGradeWriting(...a) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    courseClass: { findFirst: (...a: unknown[]) => mockCourseClassFindFirst(...a) },
    writingPrompt: { findFirst: (...a: unknown[]) => mockWritingPromptFindFirst(...a) },
    writingResponse: {
      findFirst: (...a: unknown[]) => mockWritingResponseFindFirst(...a),
      create: (...a: unknown[]) => mockWritingResponseCreate(...a),
      update: (...a: unknown[]) => mockWritingResponseUpdate(...a),
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { POST } from '@/app/api/v1/classes/[classId]/writing/[promptId]/route';

const PARAMS = { params: Promise.resolve({ classId: 'class-1', promptId: 'wp-1' }) };

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/classes/class-1/writing/wp-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GRADE = { overallScore: 0.7, corrections: [{ old: 'a', new: 'á', why: 'accent' }], feedback: 'Nice.' };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
  mockWritingPromptFindFirst.mockResolvedValue({
    task: 'Reply to the invite.',
    sectionId: 'sec-1',
    section: { class: { course: { nativeLang: 'en', targetLang: 'es', currentLevel: 'A2' } } },
  });
  mockGradeWriting.mockResolvedValue(GRADE);
  mockWritingResponseFindFirst.mockResolvedValue(null);
});

describe('POST /api/v1/classes/[classId]/writing/[promptId]', () => {
  it('grades a response and persists it', async () => {
    const res = await POST(req({ text: 'Sí, quiero ir.' }), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GRADE);
    expect(mockGradeWriting).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'Reply to the invite.', text: 'Sí, quiero ir.', level: 'A2', targetLang: 'es' }),
    );
    expect(mockWritingResponseCreate).toHaveBeenCalled();
  });

  it('updates the existing response on resubmit', async () => {
    mockWritingResponseFindFirst.mockResolvedValue({ id: 'wr-1' });
    await POST(req({ text: 'Otra vez.' }), PARAMS);
    expect(mockWritingResponseUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'wr-1' } }));
    expect(mockWritingResponseCreate).not.toHaveBeenCalled();
  });

  it('401s without auth', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await POST(req({ text: 'x' }), PARAMS);
    expect(res.status).toBe(401);
  });

  it('404s when the class is not the user\'s', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);
    const res = await POST(req({ text: 'x' }), PARAMS);
    expect(res.status).toBe(404);
    expect(mockGradeWriting).not.toHaveBeenCalled();
  });

  it('404s when the prompt is not in the class', async () => {
    mockWritingPromptFindFirst.mockResolvedValue(null);
    const res = await POST(req({ text: 'x' }), PARAMS);
    expect(res.status).toBe(404);
  });

  it('400s on an empty response', async () => {
    const res = await POST(req({ text: '   ' }), PARAMS);
    expect(res.status).toBe(400);
    expect(mockGradeWriting).not.toHaveBeenCalled();
  });
});
