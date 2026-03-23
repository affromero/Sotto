import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockDiscoveryFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockAddJob = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockReferenceFindMany = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockDiscoveryFindUnique(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    reference: {
      findMany: (...args: unknown[]) => mockReferenceFindMany(...args),
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    segment: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/queue', () => ({
  scriptGenerationQueue: 'script-generation-queue',
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { GENERATE_SCRIPT: 'GENERATE_SCRIPT' },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: vi.fn().mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: true }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/podcasts/[podcastId]/script/regenerate/route';

function createRequest(body?: object): NextRequest {
  if (body) {
    return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/script/regenerate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/script/regenerate'), {
    method: 'POST',
  });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('POST /api/podcasts/[podcastId]/script/regenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'GENERATING_AUDIO' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 404 when discovery not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Discovery not found' });
  });

  it('deletes old data, transitions to SCRIPTING, and queues regeneration job (no feedback)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: 'some content' });
    mockTransaction.mockResolvedValue(undefined);
    mockPodcastUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    // Verify no feedback fields in payload
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.userFeedback).toBeUndefined();
    expect(payload.previousTurns).toBeUndefined();
  });

  it('reads script before delete and passes feedback fields when body has feedback', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockScriptFindUnique.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Hello' },
        { speaker: 'EXPERT', text: 'Hi there' },
      ],
    });
    mockReferenceFindMany.mockResolvedValue([
      { number: 1, title: 'Ref 1', authors: ['A'], year: 2024, url: 'https://example.com', type: 'WEB', publisher: null, doi: null },
    ]);
    mockTransaction.mockResolvedValue(undefined);
    mockPodcastUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await POST(
      createRequest({ feedback: 'Make it more casual' }),
      await createParams('pod-1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    // Verify script was read before deletion
    expect(mockScriptFindUnique).toHaveBeenCalled();

    // Verify feedback fields in payload
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.userFeedback).toContain('Make it more casual');
    expect(payload.previousTurns).toHaveLength(2);
    expect(payload.previousReferences).toHaveLength(1);
  });

  it('handles empty body the same as no body (backward compat)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockPodcastUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await POST(createRequest({}), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    // No feedback fields since body was empty
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.userFeedback).toBeUndefined();
  });

  it('passes sourceUrls in job payload and resets lowReferences', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockPodcastUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await POST(
      createRequest({
        feedback: 'Need better sources',
        sourceUrls: ['https://example.com/article', 'https://bbc.co.uk/news'],
      }),
      await createParams('pod-1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    // Verify sourceUrls in payload
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.sourceUrls).toEqual(['https://example.com/article', 'https://bbc.co.uk/news']);

    // Verify lowReferences reset
    const updateData = mockPodcastUpdate.mock.calls[0][0].data;
    expect(updateData.lowReferences).toBe(false);
  });

  it('returns 400 for invalid feedback body', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const req = new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/script/regenerate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    });

    const response = await POST(req, await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid feedback body');
  });
});
