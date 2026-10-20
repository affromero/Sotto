import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/v1/courses/[courseId]/vocabulary-support/route';

const boundary = vi.hoisted(() => ({ auth: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: boundary.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { course: { updateMany: boundary.update } } }));

const params = { params: Promise.resolve({ courseId: 'course-1' }) };
function request(vocabularySupport: unknown) {
  return new NextRequest('http://localhost/api/v1/courses/course-1/vocabulary-support', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vocabularySupport }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  boundary.auth.mockResolvedValue({ userId: 'learner-1' });
  boundary.update.mockResolvedValue({ count: 1 });
});

describe('course vocabulary support', () => {
  it.each(['MEANING_RECALL', 'WORD_RECALL', 'LISTENING_RECOGNITION', null])(
    'saves or clears support through an atomic ownership-bound update: %s',
    async (vocabularySupport) => {
      const response = await PATCH(request(vocabularySupport), params);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ vocabularySupport });
      expect(boundary.update).toHaveBeenCalledWith({
        where: { id: 'course-1', userId: 'learner-1' },
        data: { vocabularySupport },
      });
    }
  );

  it('rejects an unauthenticated change', async () => {
    boundary.auth.mockResolvedValue(null);
    expect((await PATCH(request('MEANING_RECALL'), params)).status).toBe(401);
    expect(boundary.update).not.toHaveBeenCalled();
  });

  it.each(['visual learner', 3, [], { value: 'MEANING_RECALL' }])(
    'rejects invalid support: %j',
    async (value) => {
      expect((await PATCH(request(value), params)).status).toBe(400);
      expect(boundary.update).not.toHaveBeenCalled();
    }
  );

  it('does not report success for another learner’s course', async () => {
    boundary.update.mockResolvedValue({ count: 0 });
    expect((await PATCH(request('WORD_RECALL'), params)).status).toBe(404);
  });
});
