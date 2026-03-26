import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDelete = vi.fn();

vi.mock('@/lib/redis', () => ({
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
    delete: (...args: unknown[]) => mockCacheDelete(...args),
  },
  getPodcastCacheTtl: vi.fn((status: string) => {
    const active = new Set([
      'EXTRACTING', 'DISCOVERING', 'SCRIPTING', 'VERIFYING_SCRIPT',
      'VALIDATING_REFERENCES', 'GENERATING_AUDIO', 'STITCHING',
    ]);
    return active.has(status) ? 2 : 30;
  }),
  invalidatePodcastCache: (...args: unknown[]) => mockCacheDelete(`podcast:public:${args[0]}`),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: 0 }),
}));

const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockLikeFindUnique = vi.fn();
const mockSaveFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => {
  const txProxy = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
      updateMany: vi.fn(),
    },
    like: { findUnique: (...args: unknown[]) => mockLikeFindUnique(...args) },
    save: { findUnique: (...args: unknown[]) => mockSaveFindUnique(...args) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ plan: 'FREE', role: 'USER' }) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prisma: txProxy, prismaUnfiltered: txProxy };
});

const mockAuthenticateRequest = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/r2', () => ({
  resolveAudioUrl: vi.fn(async (url: string | null) => url),
}));

vi.mock('@/lib/validations', () => ({
  updatePodcastSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: { title: 'New Title' } }) },
}));

vi.mock('@/lib/slugify', () => ({
  generatePodcastSlug: vi.fn().mockResolvedValue('new-title'),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({ privateAllowed: false }),
}));

vi.mock('@/lib/byok', () => ({
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/podcast-select', () => ({
  PODCAST_PUBLIC_SELECT: { id: true, title: true, status: true, audioUrl: true, visibility: true, userId: true },
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (msg: string, status: number) => new Response(JSON.stringify({ error: msg }), { status }),
}));

vi.mock('@/lib/auth-guards', () => ({
  checkSuspension: vi.fn().mockReturnValue(null),
}));

import { NextRequest } from 'next/server';
import { GET as getPodcast, PATCH as updatePodcast } from '@/app/api/podcasts/[podcastId]/route';

const basePodcast = {
  id: 'pod-1',
  title: 'Test Podcast',
  status: 'READY',
  audioUrl: 'https://r2.example.com/audio.mp3',
  visibility: 'PUBLIC',
  userId: 'user-1',
  user: { id: 'user-1', name: 'Test', image: null },
  tags: [],
  segments: [],
  interactions: [],
  verificationProgress: null,
};

function makeRequest(method = 'GET', body?: Record<string, unknown>) {
  const url = 'http://localhost:3000/api/podcasts/pod-1';
  if (body) {
    return new NextRequest(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(url, { method });
}

const routeParams = { params: Promise.resolve({ podcastId: 'pod-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue(null);
  mockLikeFindUnique.mockResolvedValue(null);
  mockSaveFindUnique.mockResolvedValue(null);
});

describe('podcast cache behavior', () => {
  describe('GET cache', () => {
    it('returns cached data on cache hit without hitting Prisma', async () => {
      mockCacheGet.mockResolvedValue(basePodcast);

      const res = await getPodcast(makeRequest(), routeParams);
      const json = await res.json();

      expect(json.title).toBe('Test Podcast');
      expect(mockPodcastFindUnique).not.toHaveBeenCalled();
      expect(mockCacheGet).toHaveBeenCalledWith('podcast:public:pod-1');
    });

    it('queries Prisma and caches on cache miss', async () => {
      mockCacheGet.mockResolvedValue(null);
      mockPodcastFindUnique.mockResolvedValue(basePodcast);

      const res = await getPodcast(makeRequest(), routeParams);
      const json = await res.json();

      expect(json.title).toBe('Test Podcast');
      expect(mockPodcastFindUnique).toHaveBeenCalled();
      expect(mockCacheSet).toHaveBeenCalledWith('podcast:public:pod-1', basePodcast, 30);
    });

    it('uses short TTL for active pipeline statuses', async () => {
      mockCacheGet.mockResolvedValue(null);
      const activePodcast = { ...basePodcast, status: 'GENERATING_AUDIO' };
      mockPodcastFindUnique.mockResolvedValue(activePodcast);

      await getPodcast(makeRequest(), routeParams);

      expect(mockCacheSet).toHaveBeenCalledWith('podcast:public:pod-1', activePodcast, 2);
    });

    it('uses long TTL for terminal statuses', async () => {
      mockCacheGet.mockResolvedValue(null);
      mockPodcastFindUnique.mockResolvedValue(basePodcast); // status: 'READY'

      await getPodcast(makeRequest(), routeParams);

      expect(mockCacheSet).toHaveBeenCalledWith('podcast:public:pod-1', basePodcast, 30);
    });
  });

  describe('PATCH invalidation', () => {
    it('invalidates cache after updating podcast', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });
      mockPodcastUpdate.mockResolvedValue({ ...basePodcast, title: 'New Title' });

      const req = makeRequest('PATCH', { title: 'New Title' });
      await updatePodcast(req, routeParams);

      expect(mockCacheDelete).toHaveBeenCalledWith('podcast:public:pod-1');
    });
  });
});
