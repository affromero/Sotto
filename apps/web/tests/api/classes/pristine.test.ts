import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PristineRegenerationConflict } from '@/lib/classes/regeneration/pristine';
const mockRegenerateCurrentClass = vi.fn();
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
  regenerateCurrentClass: (...args: unknown[]) => mockRegenerateCurrentClass(...args),
  regenerateFailedSections: vi.fn(),
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
  it('preserves the submitted pristine snapshot for synchronous regeneration', async () => {
    mockRegenerateCurrentClass.mockResolvedValue(true);
    const snapshot = 'a'.repeat(64);
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', {
        scope: 'class',
        pristineSnapshot: snapshot,
      }),
      classParams('class-1')
    );
    expect(response.status).toBe(200);
    expect(mockRegenerateCurrentClass).toHaveBeenCalledWith(
      'class-1',
      'u1',
      expect.objectContaining({ userId: 'u1' }),
      snapshot
    );
  });

  it('returns a conflict instead of regenerating changed learner work', async () => {
    mockRegenerateCurrentClass.mockRejectedValue(new PristineRegenerationConflict());
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', {
        scope: 'class',
        pristineSnapshot: 'a'.repeat(64),
      }),
      classParams('class-1')
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('learner work') });
  });

  it.each([
    ['http://localhost/api/v1/classes/class-1?background=1', 'a'.repeat(64)],
    ['http://localhost/api/v1/classes/class-1', 'invalid'],
  ])('rejects an unsafe pristine request at %s', async (url, pristineSnapshot) => {
    const response = await POST(
      makeRequest(url, 'POST', { scope: 'class', pristineSnapshot }),
      classParams('class-1')
    );
    expect(response.status).toBe(400);
    expect(mockRegenerateCurrentClass).not.toHaveBeenCalled();
  });
});
