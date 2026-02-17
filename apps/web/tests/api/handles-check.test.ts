import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockReservedHandleFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    reservedHandle: {
      findUnique: (...args: unknown[]) => mockReservedHandleFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/claude', () => ({
  generateResponse: vi.fn().mockResolvedValue({ content: 'OK', inputTokens: 5, outputTokens: 1 }),
}));

vi.mock('@/lib/redis', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import { GET } from '@/app/api/handles/check/route';

// ---- Helpers ----

function createRequest(handle?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/handles/check');
  if (handle !== undefined) {
    url.searchParams.set('handle', handle);
  }
  return new NextRequest(url, { method: 'GET' });
}

// ---- Tests ----

describe('GET /api/handles/check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when handle parameter is missing', async () => {
    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'handle parameter is required' });
  });

  it('returns available: true for a valid, unclaimed handle', async () => {
    mockReservedHandleFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);

    const request = createRequest('cool_user_42');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ available: true });
  });

  it('returns available: false for invalid format', async () => {
    const request = createRequest('ab');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toContain('3-30 characters');
  });

  it('returns available: false for hardcoded reserved handle', async () => {
    const request = createRequest('admin');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/reserved/i);
  });

  it('returns available: false for DB-reserved handle', async () => {
    mockReservedHandleFindUnique.mockResolvedValue({
      id: 'rh-1',
      handle: 'brand_name',
    });

    const request = createRequest('brand_name');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/reserved/i);
  });

  it('returns available: false for already-taken handle', async () => {
    mockReservedHandleFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' });

    const request = createRequest('taken_handle');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/taken/i);
  });

  it('returns available: false for handles with special characters', async () => {
    const request = createRequest('user-name');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toContain('3-30 characters');
  });

  it('returns available: false for empty handle parameter', async () => {
    const request = createRequest('');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'handle parameter is required' });
  });
});
