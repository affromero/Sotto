import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PristineRegenerationConflict } from '@/lib/classes/regeneration/pristine';
const mockRequestPreparation = vi.fn();
vi.mock('@/lib/classes/preparation', () => ({
  requestClassPreparation: (...args: unknown[]) => mockRequestPreparation(...args),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    courseClass: { findFirst: async () => ({ courseId: 'course-1', status: 'AVAILABLE' }) },
  },
}));
const mockGetClass = vi.fn();
const mockSnapshot = vi.fn();
const mockValidate = vi.fn();
vi.mock('@/lib/classes/regeneration/pristine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/classes/regeneration/pristine')>()),
  readPristineRegenerationSnapshot: (...args: unknown[]) => mockSnapshot(...args),
  validatePristineRegeneration: (...args: unknown[]) => mockValidate(...args),
}));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: async () => ({ userId: 'u1' }) }));
vi.mock('@/lib/class-service', () => ({
  getClassForUser: (...args: unknown[]) => mockGetClass(...args),
  deleteClassForUser: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { GET, POST } from '@/app/api/v1/classes/[classId]/route';
function makeRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
function classParams(classId: string) {
  return { params: Promise.resolve({ classId }) };
}
describe('pristine regeneration HTTP admission', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rejects a snapshot when the visible class changes during the read', async () => {
    mockSnapshot.mockResolvedValue('a'.repeat(64));
    mockGetClass.mockResolvedValue({ id: 'class-1' });
    mockValidate.mockRejectedValue(new PristineRegenerationConflict());
    const response = await GET(
      new NextRequest('http://localhost/api/v1/classes/class-1?pristineSnapshot=1'),
      classParams('class-1')
    );
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty('pristineSnapshot');
  });
  it('preserves the submitted pristine snapshot for durable regeneration', async () => {
    mockRequestPreparation.mockResolvedValue({ id: 'operation-1' });
    const snapshot = 'a'.repeat(64);
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', {
        scope: 'class',
        expectedAttempt: 1,
        pristineSnapshot: snapshot,
      }),
      classParams('class-1')
    );
    expect(response.status).toBe(202);
    expect(mockRequestPreparation).toHaveBeenCalledWith(
      'course-1',
      expect.objectContaining({ userId: 'u1' }),
      {
        intent: {
          kind: 'REGENERATE',
          classId: 'class-1',
          expectedAttempt: 1,
          pristineSnapshot: snapshot,
        },
      }
    );
  });

  it('returns a conflict instead of regenerating changed learner work', async () => {
    mockRequestPreparation.mockRejectedValue(new PristineRegenerationConflict());
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', {
        scope: 'class',
        expectedAttempt: 1,
        pristineSnapshot: 'a'.repeat(64),
      }),
      classParams('class-1')
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('learner work') });
  });

  it.each([['http://localhost/api/v1/classes/class-1', 'invalid']])(
    'rejects an unsafe pristine request at %s',
    async (url, pristineSnapshot) => {
      const response = await POST(
        makeRequest(url, 'POST', { scope: 'class', expectedAttempt: 1, pristineSnapshot }),
        classParams('class-1')
      );
      expect(response.status).toBe(400);
      expect(mockRequestPreparation).not.toHaveBeenCalled();
    }
  );
});
