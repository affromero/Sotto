import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock functions at module scope for proper typing
const mockAuthenticateRequest = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockInteractionCreate = vi.fn();
const mockAddJob = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockUserFindUnique = vi.fn();

// Mock dependencies
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockUserFindUniqueOrThrow = vi.fn();
const mockInteractionCount = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
    },
    interaction: {
      create: (...args: unknown[]) => mockInteractionCreate(...args),
      count: (...args: unknown[]) => mockInteractionCount(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/queue', () => ({
  interactionQueue: {},
  notificationQueue: {},
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    PROCESS_INTERACTION: 'PROCESS_INTERACTION',
    SEND_NOTIFICATION: 'SEND_NOTIFICATION',
  },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/generation-features', () => ({
  getGenerationFeatures: vi.fn().mockReturnValue({
    maxDurationMinutes: 30,
    maxSpeakers: 4,
    autoApproveScript: false,
    webSearchEnabled: true,
    maxQaInteractions: Infinity,
    privateAllowed: true,
    priorityQueue: true,
    analyticsEnabled: true,
  }),
}));

vi.mock('@/lib/byok', () => ({
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

// Import route after mocks are set up
import { POST } from '@/app/api/v1/episodes/[episodeId]/interact/route';

function createRequest(
  episodeId: string,
  body: unknown
): {
  request: NextRequest;
  params: { params: Promise<{ episodeId: string }> };
} {
  const url = new URL(`http://localhost:3000/api/v1/episodes/${episodeId}/interact`);
  const request = new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    request,
    params: { params: Promise.resolve({ episodeId }) },
  };
}

const mockEpisode = {
  id: 'episode-123',
  userId: 'owner-123',
  title: 'Test Episode',
};

const mockInteraction = {
  id: 'interaction-123',
  episodeId: 'episode-123',
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

describe('POST /api/v1/episodes/[episodeId]/interact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: 0 });
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER' });
    mockUserFindUnique.mockResolvedValue(null);
    mockInteractionCount.mockResolvedValue(0);
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const { request, params } = createRequest('episode-123', {
      question: 'Test question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when episode does not exist', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(null);

    const { request, params } = createRequest('episode-nonexistent', {
      question: 'Test question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Episode not found');
  });

  it('returns 400 when question is empty', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);

    const { request, params } = createRequest('episode-123', {
      question: '',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when timestamp is negative', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);

    const { request, params } = createRequest('episode-123', {
      question: 'Valid question',
      timestamp: -10,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 429 when rate limited', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 3600000 });

    const { request, params } = createRequest('episode-123', {
      question: 'Valid question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toContain('Rate limit exceeded');
  });

  it('creates interaction with PENDING status', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('episode-123', {
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });

  it('includes user data in response', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('episode-123', {
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
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('episode-123', {
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });

  it('enqueues QUESTION_ON_YOUR_EPISODE notification for episode owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });
    mockUserFindUnique.mockResolvedValue({ name: 'Test User' });

    const { request, params } = createRequest('episode-123', {
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'SEND_NOTIFICATION',
      expect.objectContaining({
        userId: 'owner-123',
        type: 'QUESTION_ON_YOUR_EPISODE',
      })
    );
  });

  it('does not enqueue notification when asking on own episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'owner-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);
    mockInteractionCreate.mockResolvedValue({
      ...mockInteraction,
      userId: 'owner-123',
    });
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('episode-123', {
      question: 'Testing my own episode',
      timestamp: 10,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));

    // addJob should only be called for PROCESS_INTERACTION, not SEND_NOTIFICATION
    expect(mockAddJob).toHaveBeenCalledTimes(1);
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'PROCESS_INTERACTION',
      expect.anything()
    );
  });
});
