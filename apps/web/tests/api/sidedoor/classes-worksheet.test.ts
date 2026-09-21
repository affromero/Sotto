import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const enqueue = vi.fn();
  const database = {
    courseClass: { findFirst: vi.fn() },
  };
  return {
    database,
    enqueue,
    authenticateRequest: vi.fn(),
    requireAdmission: vi.fn(),
    captureCourseStorage: vi.fn(),
    deliver: vi.fn(),
  };
});

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mocks.authenticateRequest(...args),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.database, prismaUnfiltered: mocks.database }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: (_database: unknown, operation: (database: typeof mocks.database) => unknown) =>
    operation(mocks.database),
}));
vi.mock('@/lib/sidedoor/access/core/request-identity', () => ({
  requireOriginalSottoAdmission: (...args: unknown[]) => mocks.requireAdmission(...args),
}));
vi.mock('@/lib/sidedoor/storage/core/course-storage', () => ({
  captureCourseStorage: (...args: unknown[]) => mocks.captureCourseStorage(...args),
}));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', () => ({
  sottoJobOutbox: () => ({ enqueue: mocks.enqueue }),
  deliverSottoJob: (...args: unknown[]) => mocks.deliver(...args),
}));
vi.mock('@/lib/queue', () => ({ worksheetPdfQueue: { name: 'worksheet-pdf' } }));
vi.mock('@/lib/class-document', () => ({ buildClassDocument: vi.fn() }));
vi.mock('@/lib/classes/class-intro', () => ({ classIntroFromSeed: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/classes/[classId]/worksheet/route';

function request() {
  return new NextRequest('https://selfhost.example.com/api/v1/classes/class-1/worksheet', {
    method: 'POST',
  });
}

const params = { params: Promise.resolve({ classId: 'class-1' }) };

describe('POST /api/v1/classes/[classId]/worksheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    mocks.authenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mocks.database.courseClass.findFirst.mockResolvedValue({
      id: 'class-1',
      courseId: 'course-1',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mocks.captureCourseStorage.mockResolvedValue({
      scopes: [{ subjectId: 'course:course-1', generation: 3 }],
    });
    mocks.enqueue.mockImplementation(async (job) => ({
      job,
      fingerprint: 'f'.repeat(64),
    }));
    mocks.deliver.mockResolvedValue('delivered');
  });

  it('captures ownership and enqueues a versioned job with the validated origin', async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ status: 'PENDING', operationId: expect.any(String) });
    expect(mocks.requireAdmission).toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        handler: 'worksheet-pdf',
        version: 1,
        payload: {
          classId: 'class-1',
          classUpdatedAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
          appBaseUrl: 'https://selfhost.example.com',
        },
        scopes: [{ subjectId: 'course:course-1', generation: 3 }],
      })
    );
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: body.operationId, version: 1 })
    );
  });

  it('does not deliver work when the configured application origin is invalid', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'file:///tmp/sotto');
    const response = await POST(request(), params);
    expect(response.status).toBe(500);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
