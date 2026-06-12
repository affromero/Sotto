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
  getEpisodeCacheTtl: vi.fn((status: string) => {
    const active = new Set([
      'EXTRACTING', 'DISCOVERING', 'SCRIPTING', 'RESEARCHING',
      'PLANNING', 'COMPILING', 'GENERATING_AUDIO', 'STITCHING',
    ]);
    return active.has(status) ? 2 : 30;
  }),
  invalidateEpisodeCache: (...args: unknown[]) => mockCacheDelete(`episode:public:${args[0]}`),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: 0 }),
}));

const mockEpisodeFindUnique = vi.fn();
const mockEpisodeUpdate = vi.fn();
const mockLikeFindUnique = vi.fn();
const mockSaveFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => {
  const txProxy = {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
      updateMany: vi.fn(),
    },
    like: { findUnique: (...args: unknown[]) => mockLikeFindUnique(...args) },
    save: { findUnique: (...args: unknown[]) => mockSaveFindUnique(...args) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ role: 'USER' }) },
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
  updateEpisodeSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: { title: 'New Title' } }) },
}));

vi.mock('@/lib/slugify', () => ({
  generateEpisodeSlug: vi.fn().mockResolvedValue('new-title'),
}));

vi.mock('@/lib/generation-features', () => ({
  getGenerationFeatures: vi.fn().mockReturnValue({ privateAllowed: false }),
}));

vi.mock('@/lib/byok', () => ({
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/episode-select', () => ({
  EPISODE_PUBLIC_SELECT: { id: true, title: true, status: true, audioUrl: true, visibility: true, userId: true },
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (msg: string, status: number) => new Response(JSON.stringify({ error: msg }), { status }),
}));

import { NextRequest } from 'next/server';
import { GET as getEpisode, PATCH as updateEpisode } from '@/app/api/v1/episodes/[episodeId]/route';

const baseEpisode = {
  id: 'pod-1',
  title: 'Test Episode',
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
  const url = 'http://localhost:3000/api/v1/episodes/pod-1';
  if (body) {
    return new NextRequest(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(url, { method });
}

const routeParams = { params: Promise.resolve({ episodeId: 'pod-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue(null);
  mockLikeFindUnique.mockResolvedValue(null);
  mockSaveFindUnique.mockResolvedValue(null);
});

describe('episode cache behavior', () => {
  describe('GET cache', () => {
    it('returns cached data on cache hit without hitting Prisma', async () => {
      mockCacheGet.mockResolvedValue(baseEpisode);

      const res = await getEpisode(makeRequest(), routeParams);
      const json = await res.json();

      expect(json.title).toBe('Test Episode');
      expect(mockEpisodeFindUnique).not.toHaveBeenCalled();
      expect(mockCacheGet).toHaveBeenCalledWith('episode:public:pod-1');
    });

    it('queries Prisma and caches on cache miss', async () => {
      mockCacheGet.mockResolvedValue(null);
      mockEpisodeFindUnique.mockResolvedValue(baseEpisode);

      const res = await getEpisode(makeRequest(), routeParams);
      const json = await res.json();

      expect(json.title).toBe('Test Episode');
      expect(mockEpisodeFindUnique).toHaveBeenCalled();
      expect(mockCacheSet).toHaveBeenCalledWith('episode:public:pod-1', baseEpisode, 30);
    });

    it('uses short TTL for active pipeline statuses', async () => {
      mockCacheGet.mockResolvedValue(null);
      const activeEpisode = { ...baseEpisode, status: 'GENERATING_AUDIO' };
      mockEpisodeFindUnique.mockResolvedValue(activeEpisode);

      await getEpisode(makeRequest(), routeParams);

      expect(mockCacheSet).toHaveBeenCalledWith('episode:public:pod-1', activeEpisode, 2);
    });

    it('uses long TTL for terminal statuses', async () => {
      mockCacheGet.mockResolvedValue(null);
      mockEpisodeFindUnique.mockResolvedValue(baseEpisode); // status: 'READY'

      await getEpisode(makeRequest(), routeParams);

      expect(mockCacheSet).toHaveBeenCalledWith('episode:public:pod-1', baseEpisode, 30);
    });
  });

  describe('PATCH invalidation', () => {
    it('invalidates cache after updating episode', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeUpdate.mockResolvedValue({ ...baseEpisode, title: 'New Title' });

      const req = makeRequest('PATCH', { title: 'New Title' });
      await updateEpisode(req, routeParams);

      expect(mockCacheDelete).toHaveBeenCalledWith('episode:public:pod-1');
    });
  });
});
