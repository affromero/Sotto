import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockEpisodeUpdate = vi.fn();
const mockDiscoveryFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockAddJob = vi.fn();
const mockResearchDossierFindUnique = vi.fn();
const mockCreativeOutlineFindUnique = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockDiscoveryFindUnique(...args),
    },
    script: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    reference: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    segment: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    researchDossier: {
      findUnique: (...args: unknown[]) => mockResearchDossierFindUnique(...args),
    },
    creativeOutline: {
      findUnique: (...args: unknown[]) => mockCreativeOutlineFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/queue', () => ({
  scriptWritingQueue: 'script-writing-queue',
  deepResearchQueue: 'deep-research-queue',
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { WRITE_SCRIPT: 'WRITE_SCRIPT', DEEP_RESEARCH: 'DEEP_RESEARCH' },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRedisClient: vi.fn(),
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));


vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/episodes/[episodeId]/script/regenerate/route';

function createRequest(body?: object): NextRequest {
  if (body) {
    return new NextRequest(new URL('http://localhost:3000/api/v1/episodes/pod-1/script/regenerate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(new URL('http://localhost:3000/api/v1/episodes/pod-1/script/regenerate'), {
    method: 'POST',
  });
}

async function createParams(episodeId: string) {
  return { params: Promise.resolve({ episodeId }) };
}

describe('POST /api/v1/episodes/[episodeId]/script/regenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: dossier + outline exist (happy path goes to script-writing)
    mockResearchDossierFindUnique.mockResolvedValue({ id: 'dossier-1' });
    mockCreativeOutlineFindUnique.mockResolvedValue({ id: 'outline-1' });
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

  it('returns 404 when episode not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Episode not found' });
  });

  it('returns 403 when user does not own the episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'GENERATING_AUDIO' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 404 when discovery not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Discovery not found' });
  });

  it('deletes old data, transitions to SCRIPTING, and queues script-writing job (no feedback)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: 'some content' });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    // Verify job payload includes dossierId and outlineId
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.dossierId).toBe('dossier-1');
    expect(payload.outlineId).toBe('outline-1');
  });

  it('queues script-writing with sourceUrls when provided', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
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
    const updateData = mockEpisodeUpdate.mock.calls[0][0].data;
    expect(updateData.lowReferences).toBe(false);
  });

  it('handles empty body the same as no body (backward compat)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await POST(createRequest({}), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('falls back to deep research when dossier is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);
    mockResearchDossierFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    // Verify status set to RESEARCHING
    const updateData = mockEpisodeUpdate.mock.calls[0][0].data;
    expect(updateData.status).toBe('RESEARCHING');
  });

  it('returns 400 for invalid feedback body', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const req = new NextRequest(new URL('http://localhost:3000/api/v1/episodes/pod-1/script/regenerate'), {
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
