import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastCount = vi.fn();
const mockListAiProviders = vi.fn();
const mockListByokProviders = vi.fn();
const mockGetFreeTierStatus = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      count: (...args: unknown[]) => mockPodcastCount(...args),
    },
  },
}));

vi.mock('@/lib/byok', () => ({
  listAiProviders: (...args: unknown[]) => mockListAiProviders(...args),
  listByokProviders: (...args: unknown[]) => mockListByokProviders(...args),
}));

vi.mock('@/lib/generation-gate', () => ({
  getFreeTierStatus: (...args: unknown[]) => mockGetFreeTierStatus(...args),
}));

vi.mock('@/lib/stripe', () => ({
  LIMITS: {
    maxDurationMinutes: 40,
    maxVoiceClones: 10,
    canDownload: true,
    canMakePrivate: true,
    canExportPdf: true,
    hasPremiumSfx: true,
  },
  FREE_TIER_MAX_DURATION_MINUTES: 5,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/billing/usage/route';

function createRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/usage');
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/billing/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns usage stats for BYOK user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastCount.mockResolvedValue(7);
    mockListAiProviders.mockResolvedValue([{ provider: 'anthropic', isValid: true }]);
    mockListByokProviders.mockResolvedValue([{ provider: 'elevenlabs', isValid: true }]);
    mockGetFreeTierStatus.mockResolvedValue({
      freeGenerationsUsed: 3,
      freeGenerationsLimit: 5,
      freeGenerationsRemaining: 2,
      isByokUser: true,
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('FREE');
    expect(body.podcastCount).toBe(7);
    expect(body.byok.ai).toEqual([{ provider: 'anthropic', isValid: true }]);
    expect(body.byok.tts).toEqual([{ provider: 'elevenlabs', isValid: true }]);
    expect(body.freeTier.isByokUser).toBe(true);
    expect(body.limits.maxDurationMinutes).toBe(40);
    expect(body.limits.canMakePrivate).toBe(true);
  });

  it('returns reduced limits for free tier user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastCount.mockResolvedValue(1);
    mockListAiProviders.mockResolvedValue([]);
    mockListByokProviders.mockResolvedValue([]);
    mockGetFreeTierStatus.mockResolvedValue({
      freeGenerationsUsed: 1,
      freeGenerationsLimit: 5,
      freeGenerationsRemaining: 4,
      isByokUser: false,
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.limits.maxDurationMinutes).toBe(5);
    expect(body.limits.canMakePrivate).toBe(false);
  });

  it('returns 500 when an error occurs', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastCount.mockRejectedValue(new Error('Connection lost'));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Connection lost' });
  });
});
