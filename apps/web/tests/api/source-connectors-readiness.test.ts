import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockGetPrivateSourceReadiness = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/source-connectors', () => ({
  getPrivateSourceReadiness: (...args: unknown[]) => mockGetPrivateSourceReadiness(...args),
}));

import { GET } from '@/app/api/v1/source-connectors/readiness/route';

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/source-connectors/readiness');
}

describe('GET /api/v1/source-connectors/readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockGetPrivateSourceReadiness.mockResolvedValue([
      {
        id: 'slack',
        kind: 'workspace',
        label: 'Slack',
        privateOnly: true,
        status: 'action_required',
      },
      {
        id: 'gmail',
        kind: 'workspace',
        label: 'Gmail',
        privateOnly: true,
        status: 'ready',
      },
      {
        id: 'claude-code',
        kind: 'local-agent',
        label: 'Claude Code',
        privateOnly: true,
        status: 'ready',
      },
      {
        id: 'codex',
        kind: 'local-agent',
        label: 'Codex',
        privateOnly: true,
        status: 'ready',
      },
    ]);
  });

  it('requires authentication', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
    expect(mockGetPrivateSourceReadiness).not.toHaveBeenCalled();
  });

  it('returns private connector readiness with aggregate counts', async () => {
    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockAuthenticateRequest).toHaveBeenCalledOnce();
    expect(body.readyCount).toBe(3);
    expect(body.totalCount).toBe(4);
    expect(body.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'slack', privateOnly: true }),
        expect.objectContaining({ id: 'gmail', privateOnly: true }),
        expect.objectContaining({ id: 'claude-code', privateOnly: true }),
        expect.objectContaining({ id: 'codex', privateOnly: true }),
      ])
    );
  });
});
