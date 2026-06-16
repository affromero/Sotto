import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockCreateOrRaiseCourse = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
}));
vi.mock('@/lib/placement-course', () => ({
  createOrRaiseCourse: (...a: unknown[]) => mockCreateOrRaiseCourse(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/placement/manual/route';

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/placement/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/placement/manual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockCreateOrRaiseCourse.mockResolvedValue({ id: 'course-1', currentLevel: 'B1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await POST(post({ native: 'en', target: 'de', level: 'B1' }));
    expect(res.status).toBe(401);
    expect(mockCreateOrRaiseCourse).not.toHaveBeenCalled();
  });

  it('rejects an invalid CEFR level', async () => {
    const res = await POST(post({ native: 'en', target: 'de', level: 'Z9' }));
    expect(res.status).toBe(400);
    expect(mockCreateOrRaiseCourse).not.toHaveBeenCalled();
  });

  it('rejects native === target', async () => {
    const res = await POST(post({ native: 'en', target: 'en', level: 'B1' }));
    expect(res.status).toBe(400);
    expect(mockCreateOrRaiseCourse).not.toHaveBeenCalled();
  });

  it('rate-limits before doing any work', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, resetAt: 123 });
    const res = await POST(post({ native: 'en', target: 'de', level: 'B1' }));
    expect(res.status).toBe(429);
    expect(mockCreateOrRaiseCourse).not.toHaveBeenCalled();
  });

  it('creates/raises the course at the chosen level with MANUAL provenance', async () => {
    const res = await POST(post({ native: 'en', target: 'de', level: 'C1' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ courseId: 'course-1', level: 'B1' });
    expect(mockCreateOrRaiseCourse).toHaveBeenCalledWith('u1', 'en', 'de', 'C1', 'MANUAL');
  });
});
