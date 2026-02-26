import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockListAiProviders = vi.fn();
const mockListByokProviders = vi.fn();
const mockGetFreeTierStatus = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
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
    canMakePrivate: true,
    canExportPdf: true,
    hasPremiumSfx: true,
  },
}));

const mockUserFindUniqueOrThrow = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/billing/subscription/route';

function createRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/subscription');
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/billing/subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns subscription info with BYOK keys and free tier status', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockListAiProviders.mockResolvedValue([{ provider: 'anthropic', isValid: true }]);
    mockListByokProviders.mockResolvedValue([{ provider: 'elevenlabs', isValid: true }]);
    mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'FREE' });
    mockGetFreeTierStatus.mockResolvedValue({
      freeGenerationsUsed: 2,
      freeGenerationsLimit: 5,
      freeGenerationsRemaining: 3,
      isByokUser: true,
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('FREE');
    expect(body.status).toBe('ACTIVE');
    expect(body.byok.ai).toEqual([{ provider: 'anthropic', isValid: true }]);
    expect(body.byok.tts).toEqual([{ provider: 'elevenlabs', isValid: true }]);
    expect(body.freeTier).toEqual({
      used: 2,
      limit: 5,
      remaining: 3,
      isByokUser: true,
    });
    expect(body.limits).toBeDefined();
  });

  it('returns 500 when an error occurs', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockListAiProviders.mockRejectedValue(new Error('DB error'));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe('string');
  });
});
