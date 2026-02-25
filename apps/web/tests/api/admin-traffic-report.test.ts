import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockBuildTrafficReport = vi.fn();

vi.mock('@/lib/traffic-report', () => ({
  buildTrafficReport: (...args: unknown[]) => mockBuildTrafficReport(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/admin/traffic-report/route';

function createRequest(bearerToken?: string, period?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/admin/traffic-report');
  if (period) {
    url.searchParams.set('period', period);
  }
  const headers: Record<string, string> = {};
  if (bearerToken) {
    headers['authorization'] = `Bearer ${bearerToken}`;
  }
  return new NextRequest(url, { method: 'GET', headers });
}

describe('GET /api/admin/traffic-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_REPORT_KEY = 'test-admin-key';
  });

  it('returns 500 when ADMIN_REPORT_KEY is not configured', async () => {
    delete process.env.ADMIN_REPORT_KEY;

    const request = createRequest('any-key');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: 'ADMIN_REPORT_KEY not configured' });
  });

  it('returns 401 when no authorization header is provided', async () => {
    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when bearer token is incorrect', async () => {
    const request = createRequest('wrong-key');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns traffic report with default 7-day period', async () => {
    const mockReport = { users: 100, podcasts: 50 };
    mockBuildTrafficReport.mockResolvedValue(mockReport);

    const request = createRequest('test-admin-key');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(mockReport);
  });

  it('respects custom period parameter', async () => {
    mockBuildTrafficReport.mockResolvedValue({ users: 200 });

    const request = createRequest('test-admin-key', '30');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ users: 200 });
  });
});
