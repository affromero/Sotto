import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock functions at module scope for proper typing
const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockSubscriptionFindUnique = vi.fn();
const mockInteractionCreate = vi.fn();
const mockAddJob = vi.fn();
const mockCanInteract = vi.fn();
const mockConsumeCredit = vi.fn();

// Mock dependencies
vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    subscription: {
      findUnique: (...args: unknown[]) => mockSubscriptionFindUnique(...args),
    },
    interaction: {
      create: (...args: unknown[]) => mockInteractionCreate(...args),
    },
  },
}));

vi.mock('@/lib/queue', () => ({
  interactionQueue: {},
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    PROCESS_INTERACTION: 'PROCESS_INTERACTION',
  },
}));

vi.mock('@/lib/stripe', () => ({
  canInteract: (...args: unknown[]) => mockCanInteract(...args),
  INTERACTION_CREDIT_COST: 0.25,
}));

vi.mock('@/lib/credits', () => ({
  consumeCredit: (...args: unknown[]) => mockConsumeCredit(...args),
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
  userId: 'user-123',
  title: 'Test Podcast',
  status: 'READY',
  visibility: 'PUBLIC',
  createdAt: new Date(),
  updatedAt: new Date(),
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

    // Set up default mocks for credit-based interaction check
    mockUserFindUnique.mockResolvedValue({ role: 'USER' });
    mockSubscriptionFindUnique.mockResolvedValue({ creditsBalance: 5 });
    mockCanInteract.mockReturnValue({ allowed: true, cost: 0.25 });
    mockConsumeCredit.mockResolvedValue({ balanceBefore: 5, balanceAfter: 4.75 });
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

  it('returns 401 when session has no user ID', async () => {
    mockAuth.mockResolvedValue({ user: {}, expires: '2026-12-31' });

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
    expect(mockPodcastFindUnique).toHaveBeenCalledWith({
      where: { id: 'podcast-nonexistent' },
      select: { id: true },
    });
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

  it('returns 400 when question exceeds 2000 characters', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);

    const { request, params } = createRequest('podcast-123', {
      question: 'a'.repeat(2001),
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

  it('returns 400 when question is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);

    const { request, params } = createRequest('podcast-123', {
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when timestamp is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);

    const { request, params } = createRequest('podcast-123', {
      question: 'Valid question',
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when timestamp is not a number', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);

    const { request, params } = createRequest('podcast-123', {
      question: 'Valid question',
      timestamp: 'not-a-number',
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 402 when insufficient credits for interaction', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockUserFindUnique.mockResolvedValue({ role: 'USER' });
    mockSubscriptionFindUnique.mockResolvedValue({ creditsBalance: 0 });
    mockCanInteract.mockReturnValue({
      allowed: false,
      cost: 0.25,
      reason: 'Insufficient credits: interactions cost 0.25 credits, you have 0.',
    });

    const { request, params } = createRequest('podcast-123', {
      question: 'Valid question',
      timestamp: 120,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toContain('Insufficient credits');
    expect(mockCanInteract).toHaveBeenCalledWith(0, 'USER');
    expect(mockInteractionCreate).not.toHaveBeenCalled();
  });

  it('consumes 0.25 credits on successful interaction', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Valid question',
      timestamp: 120,
    });

    await POST(request, params);

    expect(mockConsumeCredit).toHaveBeenCalledWith(
      'user-123',
      0.25,
      'Interaction question',
      'podcast-123'
    );
  });

  it('does not consume credits for ADMIN users', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockSubscriptionFindUnique.mockResolvedValue({ creditsBalance: 0 });
    mockCanInteract.mockReturnValue({ allowed: true, cost: 0.25 });
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Admin question',
      timestamp: 120,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });

  it('fails if consumeCredit throws insufficient balance', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockConsumeCredit.mockRejectedValue(new Error('Insufficient credits: need 0.25, have 0'));

    const { request, params } = createRequest('podcast-123', {
      question: 'Valid question',
      timestamp: 120,
    });

    await expect(POST(request, params)).rejects.toThrow('Insufficient credits');
    expect(mockInteractionCreate).not.toHaveBeenCalled();
  });

  it('accepts timestamp 0 as valid', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Question at the start',
      timestamp: 0,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });

  it('accepts question at exactly 2000 characters', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue({
      ...mockInteraction,
      question: 'a'.repeat(2000),
    });
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'a'.repeat(2000),
      timestamp: 120,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
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

    expect(mockInteractionCreate).toHaveBeenCalledWith({
      data: {
        podcastId: 'podcast-123',
        userId: 'user-123',
        question: 'Can you explain quantum entanglement?',
        timestamp: 120.5,
        status: 'PENDING',
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    });
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

    await POST(request, params);

    expect(mockAddJob).toHaveBeenCalledWith({}, 'PROCESS_INTERACTION', {
      podcastId: 'podcast-123',
      interactionId: 'interaction-123',
      userId: 'user-123',
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
    });
  });

  it('returns complete interaction object', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      id: 'interaction-123',
      podcastId: 'podcast-123',
      userId: 'user-123',
      question: 'Can you explain quantum entanglement?',
      timestamp: 120.5,
      status: 'PENDING',
      resolved: false,
    });
  });

  it('accepts decimal timestamps', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue({
      ...mockInteraction,
      timestamp: 45.789,
    });
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Test question',
      timestamp: 45.789,
    });

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.timestamp).toBe(45.789);
  });

  it('handles large timestamp values', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue({
      ...mockInteraction,
      timestamp: 3600,
    });
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Question at 1 hour mark',
      timestamp: 3600,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });

  it('trims whitespace from question text', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue({
      ...mockInteraction,
      question: 'Test question',
    });
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: '  Test question  ',
      timestamp: 120,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });

  it('handles missing podcast select gracefully', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ id: 'podcast-123' });
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockResolvedValue({ id: 'job-123' });

    const { request, params } = createRequest('podcast-123', {
      question: 'Test question',
      timestamp: 120,
    });

    const response = await POST(request, params);

    expect(response.status).toBe(201);
  });

  it('handles queue job dispatch failure', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockPodcast);
    mockInteractionCreate.mockResolvedValue(mockInteraction);
    mockAddJob.mockRejectedValue(new Error('Queue connection failed'));

    const { request, params } = createRequest('podcast-123', {
      question: 'Test question',
      timestamp: 120,
    });

    await expect(POST(request, params)).rejects.toThrow('Queue connection failed');
  });
});
