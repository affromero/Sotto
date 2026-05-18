import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockVoiceCloneFindMany = vi.fn();
const mockVoiceCloneCount = vi.fn();
const mockVoiceRequestFindMany = vi.fn();
const mockVoicePurchaseFindMany = vi.fn();
const mockVoiceAllowlistFindMany = vi.fn();
const mockGetPlanFeatureConfig = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/plan-feature-config', () => ({
  getPlanFeatureConfig: (...args: unknown[]) => mockGetPlanFeatureConfig(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    voiceClone: {
      findMany: (...args: unknown[]) => mockVoiceCloneFindMany(...args),
      count: (...args: unknown[]) => mockVoiceCloneCount(...args),
    },
    voiceRequest: {
      findMany: (...args: unknown[]) => mockVoiceRequestFindMany(...args),
    },
    voicePurchase: {
      findMany: (...args: unknown[]) => mockVoicePurchaseFindMany(...args),
    },
    voiceAllowlist: {
      findMany: (...args: unknown[]) => mockVoiceAllowlistFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { GET } from '@/app/api/voices/browse/route';

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/voices/browse');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const mockVoice = {
  id: 'clone-1',
  name: 'My Voice',
  description: 'A warm narrator voice',
  sourceType: 'UPLOAD',
  priceInCents: null,
  createdAt: new Date('2026-01-15T10:00:00Z'),
  externalVoiceId: 'el-voice-1',
  user: {
    id: 'user-1',
    name: 'Test User',
    handle: 'testuser',
    image: null,
    stripeOnboarded: false,
  },
  _count: {
    voiceRequests: 3,
  },
};

const mockVoice2 = {
  id: 'clone-2',
  name: 'Cool Voice',
  description: null,
  sourceType: 'RECORD',
  priceInCents: null,
  createdAt: new Date('2026-01-16T10:00:00Z'),
  externalVoiceId: 'el-voice-2',
  user: {
    id: 'user-2',
    name: 'Other User',
    handle: 'otheruser',
    image: 'https://example.com/avatar.jpg',
    stripeOnboarded: false,
  },
  _count: {
    voiceRequests: 0,
  },
};

describe('GET /api/voices/browse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(null);
    mockVoiceCloneFindMany.mockResolvedValue([]);
    mockVoiceCloneCount.mockResolvedValue(0);
    mockVoicePurchaseFindMany.mockResolvedValue([]);
    mockVoiceAllowlistFindMany.mockResolvedValue([]);
    mockGetPlanFeatureConfig.mockResolvedValue({
      freeVoiceCloningEnabled: false,
      proVoiceCloningEnabled: true,
      freeVoiceTracksEnabled: false,
      proVoiceTracksEnabled: true,
      freeMaxVoiceTracks: 0,
      proMaxVoiceTracks: 3,
      voiceMarketplaceEnabled: true,
    });
  });

  it('returns 503 when the optional voice marketplace is disabled', async () => {
    mockGetPlanFeatureConfig.mockResolvedValue({
      freeVoiceCloningEnabled: false,
      proVoiceCloningEnabled: true,
      freeVoiceTracksEnabled: false,
      proVoiceTracksEnabled: true,
      freeMaxVoiceTracks: 0,
      proMaxVoiceTracks: 3,
      voiceMarketplaceEnabled: false,
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: 'Voice marketplace is currently unavailable.' });
    expect(mockVoiceCloneFindMany).not.toHaveBeenCalled();
  });

  it('returns empty results when no requestable voices exist', async () => {
    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voices).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('returns requestable voices with owner info and approved count', async () => {
    mockVoiceCloneFindMany.mockResolvedValue([mockVoice]);
    mockVoiceCloneCount.mockResolvedValue(1);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voices).toHaveLength(1);
    expect(body.voices[0]).toMatchObject({
      id: 'clone-1',
      name: 'My Voice',
      description: 'A warm narrator voice',
      sourceType: 'UPLOAD',
      owner: {
        id: 'user-1',
        name: 'Test User',
        handle: 'testuser',
      },
      approvedCount: 3,
      requestStatus: null,
    });
  });

  it('supports pagination with page and limit params', async () => {
    mockVoiceCloneFindMany.mockResolvedValue([mockVoice2]);
    mockVoiceCloneCount.mockResolvedValue(25);

    const response = await GET(createRequest({ page: '2', limit: '12' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.total).toBe(25);
    expect(body.hasMore).toBe(true);
  });

  it('filters by search term on voice name, description, owner name, and handle', async () => {
    mockVoiceCloneFindMany.mockResolvedValue([mockVoice]);
    mockVoiceCloneCount.mockResolvedValue(1);

    const response = await GET(createRequest({ search: 'warm' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voices).toHaveLength(1);
  });

  it('enriches with request status when user is authenticated', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-current', email: 'me@test.com' },
      expires: '2026-12-31',
    });
    mockVoiceCloneFindMany.mockResolvedValue([mockVoice, mockVoice2]);
    mockVoiceCloneCount.mockResolvedValue(2);
    mockVoiceRequestFindMany.mockResolvedValue([{ voiceCloneId: 'clone-1', status: 'PENDING' }]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.voices[0].requestStatus).toBe('PENDING');
    expect(body.voices[1].requestStatus).toBe(null);
  });

  it('does not enrich request status for unauthenticated users', async () => {
    mockAuth.mockResolvedValue(null);
    mockVoiceCloneFindMany.mockResolvedValue([mockVoice]);
    mockVoiceCloneCount.mockResolvedValue(1);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.voices[0].requestStatus).toBe(null);
  });

  it('returns 400 for invalid query params', async () => {
    const response = await GET(createRequest({ page: '0' }));
    expect(response.status).toBe(400);
  });

  it('returns hasMore false when on last page', async () => {
    mockVoiceCloneFindMany.mockResolvedValue([mockVoice]);
    mockVoiceCloneCount.mockResolvedValue(1);

    const response = await GET(createRequest({ page: '1', limit: '24' }));
    const body = await response.json();

    expect(body.hasMore).toBe(false);
  });
});
