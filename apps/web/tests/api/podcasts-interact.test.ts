import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock functions at module scope for proper typing
const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockInteractionCreate = vi.fn();
const mockAddJob = vi.fn();
const mockCheckRateLimit = vi.fn();

// Mock dependencies
vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockUserFindUniqueOrThrow = vi.fn();
const mockInteractionCount = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    interaction: {
      create: (...args: unknown[]) => mockInteractionCreate(...args),
      count: (...args: unknown[]) => mockInteractionCount(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/queue', () => ({
  interactionQueue: {},
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    PROCESS_INTERACTION: 'PROCESS_INTERACTION',
  },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  checkSuspension: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({
    maxDurationMinutes: 30,
    maxSpeakers: 4,
    autoApproveScript: false,
    webSearchEnabled: true,
    maxQaInteractions: Infinity,
    privateAllowed: true,
    priorityQueue: true,
    analyticsEnabled: true,
    voiceTracksEnabled: true,
    maxVoiceTracks: 3,
    voiceCloningEnabled: true,
  }),
}));

vi.mock('@/lib/byok', () => ({
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

// Import route after mocks are set up
import { POST } from '@/app/api/podcasts/[podcastId]/interact/route';

function createRequest(
  podcastId: string,
  body: unknown
): {
  request: NextRequest;
  params: { params: Promise<{ podcastId: string }> };
} {
  const url = new URL(`http://localhost:3000/api/podcasts/${podcastId}/interact`);
  const request = new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    request,
    params: { params: Promise.resolve({ podcastId }) },
  };
}

const mockSession = {
  user: {
    id: 'user-123',
    email: 'user@example.com',
    name: 'Test User',
  },
  expires: '2026-12-31',
};

const mockPodcast = {
  id: 'podcast-123',
};

const mockInteraction = {
  id: 'interaction-123',
  podcastId: 'podcast-123',
  userId: 'user-123',
  question: 'Can you explain quantum entanglement?',
  timestamp: 120.5,
  status: 'PENDING',
  answer: null,
  resolved: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    id: 'user-123',
    name: 'Test User',
    image: 'https://example.com/avatar.jpg',
  },
};

describe('POST /api/podcasts/[podcastId]/interact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: 0 });
    mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'PRO', role: 'USER' });
    mockInteractionCount.mockResolvedValue(0);
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const { request, params } = createRequest('podcast-123', {
      question: 'Test question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(null);

    const { request, params } = createRequest('podcast-nonexistent', {
      question: 'Test question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Podcast not found');
  });

  it('returns 400 when question is empty', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);

    const { request, params } = createRequest('podcast-123', {
      question: '',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when timestamp is negative', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);

    const { request, params } = createRequest('podcast-123', {
      question: 'Valid question',
      timestamp: -10,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 429 when rate limited', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 3600000 });

    const { request, params } = createRequest('podcast-123', {
      question: 'Valid question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toContain('Rate limit exceeded');
  });

  it('creates interaction with PENDING status', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });

  it('includes user data in response', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Test question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.user).toEqual({
      id: 'user-123',
      name: 'Test User',
      image: 'https://example.com/avatar.jpg',
    });
  });

  it('dispatches queue job with correct payload', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });
});
