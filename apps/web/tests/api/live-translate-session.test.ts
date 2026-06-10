/**
 * POST /api/live-translate/session — persist a finished live conversation and feed
 * its new vocab into the course graph. Adversarial: 401 unauth, 400 bad body, 404
 * for a course the caller does not own, 200 with the added count on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticate = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockExtract = vi.fn();

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: (...a: unknown[]) => mockAuthenticate(...a) }));
vi.mock('@/lib/prisma', () => ({
  prisma: { course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) } },
}));
vi.mock('@/lib/live-vocab', () => ({ extractAndStoreLiveVocab: (...a: unknown[]) => mockExtract(...a) }));

import { POST } from '@/app/api/live-translate/session/route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/live-translate/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = { courseId: 'c1', transcript: 'Ich möchte einen Kaffee bestellen.' };

describe('POST /api/live-translate/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ userId: 'u1' });
    mockCourseFindFirst.mockResolvedValue({ nativeLang: 'en', targetLang: 'de', currentLevel: 'A2' });
    mockExtract.mockResolvedValue(3);
  });

  it('rejects an unauthenticated request', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(req(VALID));
    expect(res.status).toBe(401);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('rejects a missing transcript', async () => {
    const res = await POST(req({ courseId: 'c1' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a course the caller does not own', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const res = await POST(req(VALID));
    expect(res.status).toBe(404);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('extracts vocab and returns the added count', async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 3 });
    expect(mockExtract).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', courseId: 'c1', targetLang: 'de', nativeLang: 'en', level: 'A2' }),
    );
  });
});
