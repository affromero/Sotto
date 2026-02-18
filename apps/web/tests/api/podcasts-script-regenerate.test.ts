import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockDiscoveryFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockAddJob = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
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
    segment: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    reference: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    script: {
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

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/podcasts/[podcastId]/script/regenerate/route';

function createRequest(): NextRequest {
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
    mockAuth.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'GENERATING_AUDIO' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 404 when discovery not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Discovery not found' });
  });

  it('deletes old data, transitions to SCRIPTING, and queues regeneration job', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: 'some content' });
    mockTransaction.mockResolvedValue(undefined);
    mockPodcastUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
