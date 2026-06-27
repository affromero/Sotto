import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
    expect(body).toMatchObject({ error: 'Unauthorized' });
    expect(mockGetAgentUsageStatus).not.toHaveBeenCalled();
  });

  it('returns normalized local agent usage status', async () => {
    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockAuthenticateRequest).toHaveBeenCalledOnce();
    expect(mockGetAgentUsageStatus).toHaveBeenCalledWith('user-1');
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
});
