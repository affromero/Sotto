import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockGetCostBreakdown = vi.fn();
const mockGetDailyCostTrend = vi.fn();
const mockCheckCostThresholds = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/cost-monitor', () => ({
  getCostBreakdown: (...args: unknown[]) => mockGetCostBreakdown(...args),
  getDailyCostTrend: (...args: unknown[]) => mockGetDailyCostTrend(...args),
  checkCostThresholds: (...args: unknown[]) => mockCheckCostThresholds(...args),
}));

import { GET } from '@/app/api/admin/costs/route';

function createRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/admin/costs');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url);
}

describe('GET /api/admin/costs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Admin access required' });
  });

  it('returns 400 for invalid period', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const response = await GET(createRequest({ period: 'invalid' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid period' });
  });

  it('returns cost data with default period', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const mockBreakdown = { total: 100, byProvider: {} };
    const mockTrend = [{ date: '2026-01-01', cost: 10 }];
    const mockWarnings: Array<{ level: string; message: string }> = [];
    mockGetCostBreakdown.mockResolvedValue(mockBreakdown);
    mockGetDailyCostTrend.mockResolvedValue(mockTrend);
    mockCheckCostThresholds.mockResolvedValue(mockWarnings);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      breakdown: mockBreakdown,
      trend: mockTrend,
      warnings: mockWarnings,
    });
    expect(mockGetCostBreakdown).toHaveBeenCalledWith('30d');
    expect(mockGetDailyCostTrend).toHaveBeenCalledWith(30);
  });

  it('accepts valid period parameter', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockGetCostBreakdown.mockResolvedValue({});
    mockGetDailyCostTrend.mockResolvedValue([]);
    mockCheckCostThresholds.mockResolvedValue([]);

    const response = await GET(createRequest({ period: '7d' }));

    expect(response.status).toBe(200);
    expect(mockGetCostBreakdown).toHaveBeenCalledWith('7d');
  });

  it('clamps trendDays to max 90', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockGetCostBreakdown.mockResolvedValue({});
    mockGetDailyCostTrend.mockResolvedValue([]);
    mockCheckCostThresholds.mockResolvedValue([]);

    const response = await GET(createRequest({ trendDays: '200' }));

    expect(response.status).toBe(200);
    expect(mockGetDailyCostTrend).toHaveBeenCalledWith(90);
  });
});
