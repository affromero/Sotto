// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const boundary = vi.hoisted(() => ({ authenticate: vi.fn(), cancel: vi.fn(), admit: vi.fn() }));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: boundary.authenticate }));
vi.mock('@/lib/prisma', () => ({
  prisma: { course: { findFirst: async () => ({ id: 'course' }) } },
}));
vi.mock('@/lib/classes/preparation', () => ({
  cancelClassPreparation: boundary.cancel,
  requestClassPreparation: boundary.admit,
}));
import { DELETE } from '@/app/api/v1/courses/[courseId]/generation/route';
import { POST } from '@/app/api/v1/courses/[courseId]/next-class/route';
import { PreparationConflictError } from '@/lib/classes/preparation-state';

const operationId = '198d50f9-86f6-432d-9fa1-3c097bf4ca62';
const params = { params: Promise.resolve({ courseId: 'course' }) };
const remove = (query = `operationId=${operationId}&classId=class`) =>
  DELETE(
    new NextRequest(`http://localhost/api/v1/courses/course/generation?${query}`, {
      method: 'DELETE',
    }),
    params
  );
const retry = (query = `expectedOperationId=${operationId}&expectedClassId=class`) =>
  POST(
    new NextRequest(`http://localhost/api/v1/courses/course/next-class?background=1&${query}`, {
      method: 'POST',
    }),
    params
  );
beforeEach(() => {
  vi.resetAllMocks();
  boundary.authenticate.mockResolvedValue({ userId: 'learner' });
  boundary.cancel.mockResolvedValue({ id: operationId, classId: 'class', status: 'FAILED' });
  boundary.admit.mockResolvedValue({ id: 'new-operation', status: 'QUEUED' });
});

describe('exact failed initial preparation recovery', () => {
  it('confirms deletion only through exact server-verified terminal cleanup', async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, operationId, classId: 'class' });
    expect(boundary.cancel.mock.calls[0]?.[2]).toEqual({ operationId, classId: 'class' });
  });
  it('passes the observed failed target into atomic next-class admission', async () => {
    const response = await retry();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ started: true, operationId: 'new-operation' });
    expect(boundary.admit.mock.calls[0]?.[2]).toEqual({
      expectedPreviousPreparation: { operationId, classId: 'class' },
    });
  });
  it.each(['', 'not-a-uuid'])('rejects an invalid cleanup operation %j', async (id) => {
    expect((await remove(`operationId=${id}&classId=class`)).status).toBe(400);
    expect((await retry(`expectedOperationId=${id}&expectedClassId=class`)).status).toBe(400);
  });
  it('rejects incomplete target pairs', async () => {
    expect((await remove(`operationId=${operationId}`)).status).toBe(400);
    expect((await retry('expectedClassId=class')).status).toBe(400);
  });
  it('keeps unconfirmed cleanup and changed admissions as conflicts', async () => {
    boundary.cancel.mockRejectedValue(new PreparationConflictError('Cleanup is not confirmed.'));
    boundary.admit.mockRejectedValue(new PreparationConflictError('Preparation changed.'));
    expect((await remove()).status).toBe(409);
    expect((await retry()).status).toBe(409);
  });
});
