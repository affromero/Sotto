import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaPodcastCount = vi.fn();
const mockPrismaInteractionCount = vi.fn();
const mockPrismaSubscriptionFindUnique = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
    podcast: {
      count: (...args: unknown[]) => mockPrismaPodcastCount(...args),
    },
    interaction: {
      count: (...args: unknown[]) => mockPrismaInteractionCount(...args),
    },
    subscription: {
      findUnique: (...args: unknown[]) => mockPrismaSubscriptionFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/stripe', () => ({
  TIER_LIMITS: {
    FREE: {
      podcastsPerMonth: 2,
      maxDurationMinutes: 10,
      interactionsPerPodcast: 2,
      premiumVoiceCredits: 0,
    },
    PRO: {
      podcastsPerMonth: 8,
      maxDurationMinutes: 10,
      interactionsPerPodcast: 10,
      premiumVoiceCredits: 3,
    },
    CREATOR: {
      podcastsPerMonth: 30,
      maxDurationMinutes: 10,
      interactionsPerPodcast: Infinity,
      premiumVoiceCredits: 10,
    },
  },
}));

import { GET } from '@/app/api/billing/usage/route';

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/usage');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const mockUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  podcastsUsed: 3,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-15T00:00:00Z'),
};

const mockSubscription = {
  id: 'sub-1',
  userId: 'user-1',
  tier: 'PRO',
  status: 'ACTIVE',
  premiumCreditsUsed: 2,
  currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
};

describe('GET /api/billing/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when user session exists but no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns usage data with correct response shape', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(3);
    mockPrismaInteractionCount.mockResolvedValue(5);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('podcastsUsed');
    expect(body).toHaveProperty('podcastsAllowed');
    expect(body).toHaveProperty('podcastsRemaining');
    expect(body).toHaveProperty('interactionsThisMonth');
    expect(body).toHaveProperty('premiumCreditsUsed');
    expect(body).toHaveProperty('premiumCreditsTotal');
    expect(body).toHaveProperty('premiumCreditsRemaining');
    expect(body).toHaveProperty('currentPeriodStart');
    expect(body).toHaveProperty('currentPeriodEnd');
  });

  it('returns correct usage data for PRO tier user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(3);
    mockPrismaInteractionCount.mockResolvedValue(15);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('PRO');
    expect(body.podcastsUsed).toBe(3);
    expect(body.podcastsAllowed).toBe(8);
    expect(body.podcastsRemaining).toBe(5);
    expect(body.interactionsThisMonth).toBe(15);
    expect(body.premiumCreditsUsed).toBe(2);
    expect(body.premiumCreditsTotal).toBe(3);
    expect(body.premiumCreditsRemaining).toBe(1);
  });

  it('returns correct usage data for FREE tier user with no subscription', async () => {
    const freeUser = { ...mockUser, podcastsUsed: 1 };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(freeUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);
    mockPrismaPodcastCount.mockResolvedValue(1);
    mockPrismaInteractionCount.mockResolvedValue(2);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('FREE');
    expect(body.podcastsUsed).toBe(1);
    expect(body.podcastsAllowed).toBe(2);
    expect(body.podcastsRemaining).toBe(1);
    expect(body.interactionsThisMonth).toBe(2);
    expect(body.premiumCreditsUsed).toBe(0);
    expect(body.premiumCreditsTotal).toBe(0);
    expect(body.premiumCreditsRemaining).toBe(0);
  });

  it('returns correct usage data for CREATOR tier user', async () => {
    const creatorUser = { ...mockUser, podcastsUsed: 15 };
    const creatorSubscription = { ...mockSubscription, tier: 'CREATOR', premiumCreditsUsed: 7 };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(creatorUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(creatorSubscription);
    mockPrismaPodcastCount.mockResolvedValue(15);
    mockPrismaInteractionCount.mockResolvedValue(100);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('CREATOR');
    expect(body.podcastsUsed).toBe(15);
    expect(body.podcastsAllowed).toBe(30);
    expect(body.podcastsRemaining).toBe(15);
    expect(body.interactionsThisMonth).toBe(100);
    expect(body.premiumCreditsUsed).toBe(7);
    expect(body.premiumCreditsTotal).toBe(10);
    expect(body.premiumCreditsRemaining).toBe(3);
  });

  it('handles user at usage limit', async () => {
    const limitedUser = { ...mockUser, podcastsUsed: 8 };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(limitedUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(8);
    mockPrismaInteractionCount.mockResolvedValue(20);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.podcastsUsed).toBe(8);
    expect(body.podcastsAllowed).toBe(8);
    expect(body.podcastsRemaining).toBe(0);
  });

  it('handles user exceeding usage limit', async () => {
    const overLimitUser = { ...mockUser, podcastsUsed: 10 };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(overLimitUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(10);
    mockPrismaInteractionCount.mockResolvedValue(25);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.podcastsUsed).toBe(10);
    expect(body.podcastsAllowed).toBe(8);
    expect(body.podcastsRemaining).toBe(0);
  });

  it('includes current billing period dates for active subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(3);
    mockPrismaInteractionCount.mockResolvedValue(5);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.currentPeriodStart).toBe('2026-01-01T00:00:00.000Z');
    expect(body.currentPeriodEnd).toBe('2026-02-01T00:00:00.000Z');
  });

  it('returns null period dates for FREE tier users', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);
    mockPrismaPodcastCount.mockResolvedValue(1);
    mockPrismaInteractionCount.mockResolvedValue(2);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.currentPeriodStart).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
  });

  it('filters podcast count by period when subscription exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(3);
    mockPrismaInteractionCount.mockResolvedValue(5);

    const request = createRequest();
    await GET(request);

    expect(mockPrismaPodcastCount).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        createdAt: {
          gte: mockSubscription.currentPeriodStart,
        },
      },
    });
  });

  it('filters interaction count by period when subscription exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(3);
    mockPrismaInteractionCount.mockResolvedValue(5);

    const request = createRequest();
    await GET(request);

    expect(mockPrismaInteractionCount).toHaveBeenCalledWith({
      where: {
        podcast: {
          userId: 'user-1',
        },
        createdAt: {
          gte: mockSubscription.currentPeriodStart,
        },
      },
    });
  });

  it('counts all podcasts when no subscription period exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);
    mockPrismaPodcastCount.mockResolvedValue(1);
    mockPrismaInteractionCount.mockResolvedValue(2);

    const request = createRequest();
    await GET(request);

    expect(mockPrismaPodcastCount).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
      },
    });
  });

  it('counts all interactions when no subscription period exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);
    mockPrismaPodcastCount.mockResolvedValue(1);
    mockPrismaInteractionCount.mockResolvedValue(2);

    const request = createRequest();
    await GET(request);

    expect(mockPrismaInteractionCount).toHaveBeenCalledWith({
      where: {
        podcast: {
          userId: 'user-1',
        },
      },
    });
  });

  it('handles zero usage correctly', async () => {
    const zeroUser = { ...mockUser, podcastsUsed: 0 };
    const zeroSubscription = { ...mockSubscription, premiumCreditsUsed: 0 };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(zeroUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(zeroSubscription);
    mockPrismaPodcastCount.mockResolvedValue(0);
    mockPrismaInteractionCount.mockResolvedValue(0);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.podcastsUsed).toBe(0);
    expect(body.podcastsRemaining).toBe(8);
    expect(body.interactionsThisMonth).toBe(0);
    expect(body.premiumCreditsUsed).toBe(0);
    expect(body.premiumCreditsRemaining).toBe(3);
  });

  it('handles database errors gracefully', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockRejectedValue(new Error('Database connection failed'));

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('handles user not found error', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-999' } });
    mockPrismaUserFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('User not found');
  });

  it('calculates remaining podcasts correctly with negative result', async () => {
    const overUser = { ...mockUser, podcastsUsed: 12 };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(overUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaPodcastCount.mockResolvedValue(12);
    mockPrismaInteractionCount.mockResolvedValue(30);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.podcastsRemaining).toBe(0);
  });

  it('calculates remaining premium credits correctly with negative result', async () => {
    const overSubscription = { ...mockSubscription, premiumCreditsUsed: 5 };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(overSubscription);
    mockPrismaPodcastCount.mockResolvedValue(3);
    mockPrismaInteractionCount.mockResolvedValue(10);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.premiumCreditsUsed).toBe(5);
    expect(body.premiumCreditsTotal).toBe(3);
    expect(body.premiumCreditsRemaining).toBe(0);
  });
});
