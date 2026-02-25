import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockAggregate = vi.fn();
const mockGroupBy = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiUsageLog: {
      aggregate: (...args: unknown[]) => mockAggregate(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
    $queryRaw: (...args: unknown[]) => {
      const result = mockQueryRaw(...args);
      // The route calls .catch() on the queryRaw result
      if (result && typeof result.catch === 'function') return result;
      return { catch: () => result };
    },
  },
}));

vi.mock('@prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    empty: { strings: [''], values: [] },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/analytics/route';

function createRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/analytics');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid period', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const response = await GET(createRequest({ period: 'invalid' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns analytics data with default 30d period', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    mockAggregate.mockResolvedValue({
      _sum: { totalCost: 12.5 },
      _count: 42,
      _avg: { durationMs: 350 },
    });

    // groupBy is called twice: once for service, once for category
    mockGroupBy
      .mockResolvedValueOnce([
        { service: 'claude', _sum: { totalCost: 10.0 }, _count: 30 },
        { service: 'elevenlabs', _sum: { totalCost: 2.5 }, _count: 12 },
      ])
      .mockResolvedValueOnce([
        { category: 'generation', _sum: { totalCost: 8.0 }, _count: 25 },
        { category: 'interaction', _sum: { totalCost: 4.5 }, _count: 17 },
      ]);

    mockQueryRaw.mockReturnValue([
      { date: new Date('2026-02-15'), count: BigInt(10), total_cost: 5.0 },
    ]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({
      totalCost: 12.5,
      totalRequests: 42,
      avgDurationMs: 350,
    });
    expect(body.byService).toHaveLength(2);
    expect(body.byService[0].service).toBe('claude');
    expect(body.byCategory).toHaveLength(2);
    expect(body.period).toBe('30d');
  });

  it('accepts "all" period', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    mockAggregate.mockResolvedValue({
      _sum: { totalCost: null },
      _count: 0,
      _avg: { durationMs: null },
    });
    mockGroupBy.mockResolvedValue([]);
    mockQueryRaw.mockReturnValue([]);

    const response = await GET(createRequest({ period: 'all' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({
      totalCost: 0,
      totalRequests: 0,
      avgDurationMs: null,
    });
    expect(body.byService).toEqual([]);
    expect(body.byCategory).toEqual([]);
    expect(body.timeSeries).toEqual([]);
    expect(body.period).toBe('all');
  });

  it('handles 7d period', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    mockAggregate.mockResolvedValue({
      _sum: { totalCost: 3.0 },
      _count: 5,
      _avg: { durationMs: 200 },
    });
    mockGroupBy.mockResolvedValue([]);
    mockQueryRaw.mockReturnValue([]);

    const response = await GET(createRequest({ period: '7d' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.period).toBe('7d');
    expect(body.summary.totalCost).toBe(3.0);
  });
});
