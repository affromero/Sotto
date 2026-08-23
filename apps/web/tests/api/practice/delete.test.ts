import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { practiceSession: { deleteMany: (...a: unknown[]) => mockDeleteMany(...a) } },
}));
vi.mock('@/lib/practice-service', () => ({
  PracticeSessionNotFoundError: class extends Error {},
}));
vi.mock('@/lib/practice/resume', () => ({ resumePractice: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '@/app/api/v1/practice/[sessionId]/route';

const PARAMS = { params: Promise.resolve({ sessionId: 'ps1' }) };
const request = () => new NextRequest('http://localhost/api/v1/practice/ps1', { method: 'DELETE' });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  mockDeleteMany.mockResolvedValue({ count: 1 });
});

describe('DELETE /api/v1/practice/[sessionId]', () => {
  it('discards the session', async () => {
    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });

  it('only deletes a session on a course the caller owns', async () => {
    await DELETE(request(), PARAMS);

    // Scoping through the course is what stops one learner deleting another's
    // session by guessing an id.
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: 'ps1', course: { userId: 'u1' } },
    });
  });

  it('answers 404 when nothing matched, rather than claiming success', async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 });

    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated caller before touching the database', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(401);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('reports a database failure as a 500', async () => {
    mockDeleteMany.mockRejectedValue(new Error('connection lost'));

    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(500);
  });
});
