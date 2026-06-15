import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRunNotesDeduction = vi.fn();
const mockGetCachedNotesDeduction = vi.fn();
const mockClearNotesDeduction = vi.fn();
const mockCreateOrRaiseCourse = vi.fn();
const mockGetCourseNote = vi.fn();
const mockMergeCourseNote = vi.fn();
const mockSetCourseNote = vi.fn();
const mockExtractAndStoreNoteVocab = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
}));
vi.mock('@/lib/placement-notes', () => ({
  runNotesDeduction: (...a: unknown[]) => mockRunNotesDeduction(...a),
  getCachedNotesDeduction: (...a: unknown[]) => mockGetCachedNotesDeduction(...a),
  clearNotesDeduction: (...a: unknown[]) => mockClearNotesDeduction(...a),
}));
vi.mock('@/lib/placement-course', () => ({
  createOrRaiseCourse: (...a: unknown[]) => mockCreateOrRaiseCourse(...a),
}));
vi.mock('@/lib/course-notes', () => ({
  getCourseNote: (...a: unknown[]) => mockGetCourseNote(...a),
  mergeCourseNote: (...a: unknown[]) => mockMergeCourseNote(...a),
  setCourseNote: (...a: unknown[]) => mockSetCourseNote(...a),
}));
vi.mock('@/lib/live-vocab', () => ({
  extractAndStoreNoteVocab: (...a: unknown[]) => mockExtractAndStoreNoteVocab(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as DEDUCE } from '@/app/api/v1/placement/from-notes/route';
import { POST as CONFIRM } from '@/app/api/v1/placement/from-notes/confirm/route';

function jsonPost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/placement/from-notes (deduce)', () => {
  const url = 'http://localhost:3000/api/v1/placement/from-notes';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, resetAt: Date.now() + 3600000 });
    mockRunNotesDeduction.mockResolvedValue({ level: 'B1', rationale: 'Subordinate clauses.', confidence: 0.8 });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await DEDUCE(jsonPost(url, { native: 'en', target: 'es', content: 'hola' }));
    expect(res.status).toBe(401);
    expect(mockRunNotesDeduction).not.toHaveBeenCalled();
  });

  it('returns 400 when native and target are the same', async () => {
    const res = await DEDUCE(jsonPost(url, { native: 'en', target: 'en', content: 'x' }));
    expect(res.status).toBe(400);
    expect(mockRunNotesDeduction).not.toHaveBeenCalled();
  });

  it('returns 400 when content is empty', async () => {
    const res = await DEDUCE(jsonPost(url, { native: 'en', target: 'es', content: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 3600000 });
    const res = await DEDUCE(jsonPost(url, { native: 'en', target: 'es', content: 'hola' }));
    expect(res.status).toBe(429);
    expect(mockRunNotesDeduction).not.toHaveBeenCalled();
  });

  it('deduces a level and returns it without creating a course', async () => {
    const res = await DEDUCE(jsonPost(url, { native: 'en', target: 'es', content: 'mi cuaderno' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      native: 'en',
      target: 'es',
      deducedLevel: 'B1',
      rationale: 'Subordinate clauses.',
      confidence: 0.8,
    });
    expect(mockRunNotesDeduction).toHaveBeenCalledWith('u1', 'en', 'es', 'mi cuaderno');
  });
});

describe('POST /api/v1/placement/from-notes/confirm', () => {
  const url = 'http://localhost:3000/api/v1/placement/from-notes/confirm';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockGetCachedNotesDeduction.mockResolvedValue({
      level: 'B1',
      rationale: 'r',
      confidence: 0.8,
      content: 'mis materiales',
    });
    mockCreateOrRaiseCourse.mockResolvedValue({ id: 'course-1', currentLevel: 'B1' });
    mockGetCourseNote.mockResolvedValue('');
    mockMergeCourseNote.mockReturnValue('mis materiales');
    mockSetCourseNote.mockResolvedValue(undefined);
    mockExtractAndStoreNoteVocab.mockResolvedValue(7);
    mockClearNotesDeduction.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await CONFIRM(jsonPost(url, { native: 'en', target: 'es' }));
    expect(res.status).toBe(401);
    expect(mockCreateOrRaiseCourse).not.toHaveBeenCalled();
  });

  it('returns 409 when the deduction has expired (no cache)', async () => {
    mockGetCachedNotesDeduction.mockResolvedValue(null);
    const res = await CONFIRM(jsonPost(url, { native: 'en', target: 'es' }));
    expect(res.status).toBe(409);
    expect(mockCreateOrRaiseCourse).not.toHaveBeenCalled();
  });

  it('creates the course at the deduced level and seeds note + vocab', async () => {
    const res = await CONFIRM(jsonPost(url, { native: 'en', target: 'es' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ courseId: 'course-1', level: 'B1', addedVocabulary: 7 });

    expect(mockCreateOrRaiseCourse).toHaveBeenCalledWith('u1', 'en', 'es', 'B1');
    expect(mockSetCourseNote).toHaveBeenCalledWith('course-1', 'mis materiales');
    expect(mockExtractAndStoreNoteVocab).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'course-1', userId: 'u1', level: 'B1', note: 'mis materiales' }),
    );
    expect(mockClearNotesDeduction).toHaveBeenCalledWith('u1', 'en', 'es');
  });
});
