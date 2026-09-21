import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AccessError } from 'thesidedoor-core/access';

const mockAuthenticateRequest = vi.fn();
const mockGetAgentUsageStatus = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/agent-usage', () => ({
  getAgentUsageStatus: (...args: unknown[]) => mockGetAgentUsageStatus(...args),
}));

import { GET } from '@/app/api/v1/agent-usage/route';

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/agent-usage');
}

describe('GET /api/v1/agent-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockGetAgentUsageStatus.mockResolvedValue({
      providers: [
        {
          id: 'claude-code',
          category: 'agent',
          label: 'Claude Code',
          shortLabel: 'Claude',
          planLabel: 'Max',
          status: 'ready',
          detail: 'Claude Code usage windows are current.',
          windows: [{ label: '5h', usedPercent: 20, remainingPercent: 80, resetIn: '1h00m' }],
          credits: null,
          limitReached: false,
          refreshedAt: '2026-06-27T10:00:00.000Z',
        },
      ],
      refreshedAt: '2026-06-27T10:00:00.000Z',
      cacheTtlSeconds: 60,
    });
  });

  it('requires authentication', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({ error: 'Unauthorized' });
    expect(mockGetAgentUsageStatus).not.toHaveBeenCalled();
  });

  it('returns normalized local agent usage status', async () => {
    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mockAuthenticateRequest).toHaveBeenCalledOnce();
    expect(mockGetAgentUsageStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        signal: expect.any(AbortSignal),
        authorize: expect.any(Function),
      })
    );
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude-code',
          planLabel: 'Max',
          status: 'ready',
        }),
      ])
    );
  });

  it('returns sanitized access failures without making the response cacheable', async () => {
    mockGetAgentUsageStatus.mockRejectedValue(
      new AccessError('forbidden', 'private account details')
    );
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('private account details');
  });

  it('does not publish a usage result after the caller cancels', async () => {
    const controller = new AbortController();
    const request = new NextRequest('http://localhost:3000/api/v1/agent-usage', {
      signal: controller.signal,
    });
    mockGetAgentUsageStatus.mockImplementation(async () => {
      controller.abort();
      return { providers: [{ detail: 'private usage result' }] };
    });
    const response = await GET(request);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('private usage result');
  });
});
