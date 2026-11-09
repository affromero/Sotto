// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const boundary = vi.hoisted(() => ({ authenticate: vi.fn(), acknowledge: vi.fn() }));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: boundary.authenticate }));
vi.mock('@/lib/learning/speaking/recovery', () => ({
  acknowledgeUnresolvedSpeaking: boundary.acknowledge,
}));
vi.mock('@/lib/sidedoor/access/core/http', () => ({
  accessOperation: async (
    _request: Request,
    _browser: boolean,
    operation: () => Promise<Response>
  ) => operation(),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  sottoRequestExecution: (_request: Request, identity: { userId: string }) => ({
    userId: identity.userId,
  }),
}));

import { POST } from '@/app/api/v1/classes/[classId]/speaking/[promptId]/recovery/route';

describe('class speaking recovery acknowledgment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.authenticate.mockResolvedValue({ userId: 'learner' });
    boundary.acknowledge.mockResolvedValue({ acknowledged: true });
  });
  const call = (body: unknown) =>
    POST(
      new NextRequest('http://localhost/api/v1/classes/c/speaking/p/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ classId: 'c', promptId: 'p' }) }
    );

  it('requires an explicit acknowledgment before changing saved recovery', async () => {
    expect((await call({ recordingId: 'r', acknowledgePossibleCharges: false })).status).toBe(400);
  });

  it('returns the saved acknowledgment for a valid request', async () => {
    const response = await call({ recordingId: 'r', acknowledgePossibleCharges: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ acknowledged: true });
  });
});
