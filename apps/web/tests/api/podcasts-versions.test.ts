import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastVersionFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    podcastVersion: {
      findMany: (...args: unknown[]) => mockPodcastVersionFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/podcasts/[podcastId]/versions/route';

function createRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/versions'));
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('GET /api/podcasts/[podcastId]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('returns 403 for private podcast when user is not the owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({
      id: 'pod-1',
      userId: 'other-user',
      visibility: 'PRIVATE',
      currentVersion: 1,
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('allows owner to view versions of private podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({
      id: 'pod-1',
      userId: 'user-1',
      visibility: 'PRIVATE',
      currentVersion: 2,
    });
    mockPodcastVersionFindMany.mockResolvedValue([
      { id: 'v-2', version: 2, audioUrl: 'url2', duration: 120, changeType: 'QA_INCORPORATED', changeSummary: 'Added Q&A', createdAt: new Date() },
      { id: 'v-1', version: 1, audioUrl: 'url1', duration: 100, changeType: 'INITIAL', changeSummary: null, createdAt: new Date() },
    ]);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.versions).toHaveLength(2);
    expect(body.currentVersion).toBe(2);
  });

  it('allows any authenticated user to view versions of public podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({
      id: 'pod-1',
      userId: 'other-user',
      visibility: 'PUBLIC',
      currentVersion: 1,
    });
    const versions = [
      { id: 'v-1', version: 1, audioUrl: 'url1', duration: 90, changeType: 'INITIAL', changeSummary: null, createdAt: new Date() },
    ];
    mockPodcastVersionFindMany.mockResolvedValue(versions);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.versions).toHaveLength(1);
    expect(body.currentVersion).toBe(1);
  });

  it('returns empty versions array when no versions exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({
      id: 'pod-1',
      userId: 'user-1',
      visibility: 'PUBLIC',
      currentVersion: null,
    });
    mockPodcastVersionFindMany.mockResolvedValue([]);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.versions).toEqual([]);
    expect(body.currentVersion).toBeNull();
  });
});
