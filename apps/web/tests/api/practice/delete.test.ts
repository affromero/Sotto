import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockFindFirst = vi.fn();
const mockDelete = vi.fn();
const mockFindMany = vi.fn();
const mockVocabDeleteMany = vi.fn();
const mockGrammarDeleteMany = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    practiceSession: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
    },
    learnerVocab: { deleteMany: (...a: unknown[]) => mockVocabDeleteMany(...a) },
    learnerGrammar: { deleteMany: (...a: unknown[]) => mockGrammarDeleteMany(...a) },
  },
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

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ps1',
    courseId: 'c1',
    vocabLemmas: ['gestern', 'die Reise'],
    grammarKeys: ['perfekt-haben'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  mockFindFirst.mockResolvedValue(session());
  mockDelete.mockResolvedValue({});
  mockFindMany.mockResolvedValue([]);
  mockVocabDeleteMany.mockResolvedValue({ count: 2 });
  mockGrammarDeleteMany.mockResolvedValue({ count: 1 });
});

describe('DELETE /api/v1/practice/[sessionId]', () => {
  it('discards the session', async () => {
    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, pruned: { vocab: 2, grammar: 1 } });
  });

  it('only deletes a session on a course the caller owns', async () => {
    await DELETE(request(), PARAMS);

    // Scoping through the course is what stops one learner deleting another's
    // session by guessing an id.
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ps1', course: { userId: 'u1' } } })
    );
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'ps1' } });
  });

  it('answers 404 when nothing matched, rather than claiming success', async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller before touching the database', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('reports a database failure as a 500', async () => {
    mockFindFirst.mockRejectedValue(new Error('connection lost'));

    const res = await DELETE(request(), PARAMS);

    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/v1/practice/[sessionId] — memory graph cleanup', () => {
  it('removes only targets never reviewed and never taught by a class', async () => {
    await DELETE(request(), PARAMS);

    expect(mockVocabDeleteMany).toHaveBeenCalledWith({
      where: {
        courseId: 'c1',
        lemma: { in: ['gestern', 'die Reise'] },
        firstSeenClassId: null,
        reps: 0,
        lastReviewed: null,
      },
    });
    expect(mockGrammarDeleteMany).toHaveBeenCalledWith({
      where: {
        courseId: 'c1',
        topicKey: { in: ['perfekt-haben'] },
        reps: 0,
        lastReviewed: null,
      },
    });
  });

  it('keeps anything another session still reviews', async () => {
    mockFindMany.mockResolvedValue([
      { vocabLemmas: ['die Reise'], grammarKeys: ['perfekt-haben'] },
    ]);

    await DELETE(request(), PARAMS);

    expect(mockVocabDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lemma: { in: ['gestern'] } }),
      })
    );
    // Every grammar key is still claimed, so nothing to prune there.
    expect(mockGrammarDeleteMany).not.toHaveBeenCalled();
  });

  it('looks for survivors only after the session is gone, so it cannot vouch for itself', async () => {
    const order: string[] = [];
    mockDelete.mockImplementation(async () => {
      order.push('delete');
      return {};
    });
    mockFindMany.mockImplementation(async () => {
      order.push('survivors');
      return [];
    });

    await DELETE(request(), PARAMS);

    expect(order).toEqual(['delete', 'survivors']);
  });

  it('touches the memory graph not at all when the session had no targets', async () => {
    mockFindFirst.mockResolvedValue(session({ vocabLemmas: [], grammarKeys: [] }));

    const res = await DELETE(request(), PARAMS);

    expect(await res.json()).toEqual({ deleted: true, pruned: { vocab: 0, grammar: 0 } });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockVocabDeleteMany).not.toHaveBeenCalled();
    expect(mockGrammarDeleteMany).not.toHaveBeenCalled();
  });
});
