import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockInteractionFindMany = vi.fn();
const mockInteractionCount = vi.fn();
const mockInteractionVoteFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    interaction: {
      findMany: (...args: unknown[]) => mockInteractionFindMany(...args),
      count: (...args: unknown[]) => mockInteractionCount(...args),
    },
    interactionVote: {
      findMany: (...args: unknown[]) => mockInteractionVoteFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@prisma/client', () => ({
  InteractionStatus: {
    ANSWERED: 'ANSWERED',
    RESOLVED: 'RESOLVED',
    INCORPORATED: 'INCORPORATED',
    PENDING: 'PENDING',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/podcasts/[podcastId]/questions/route';

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/pod-1/questions');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return new NextRequest(url);
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('GET /api/podcasts/[podcastId]/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 404 for private podcast when user is not the owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PRIVATE', userId: 'other-user' });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('allows owner to view questions on private podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PRIVATE', userId: 'user-1' });
    mockInteractionFindMany.mockResolvedValue([]);
    mockInteractionCount.mockResolvedValue(0);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  });

  it('returns questions with hasVoted enrichment for authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PUBLIC', userId: 'other-user' });
    const now = new Date('2025-01-01T00:00:00Z');
    const questions = [
      {
        id: 'q-1',
        question: 'What is this about?',
        answer: 'It is about testing.',
        timestamp: 30,
        upvoteCount: 5,
        createdAt: now,
        user: { id: 'user-2', name: 'Alice', image: null, handle: 'alice' },
      },
      {
        id: 'q-2',
        question: 'Can you explain more?',
        answer: 'Sure thing.',
        timestamp: 60,
        upvoteCount: 2,
        createdAt: now,
        user: { id: 'user-3', name: 'Bob', image: null, handle: 'bob' },
      },
    ];
    mockInteractionFindMany.mockResolvedValue(questions);
    mockInteractionCount.mockResolvedValue(2);
    mockInteractionVoteFindMany.mockResolvedValue([{ interactionId: 'q-1' }]);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].hasVoted).toBe(true);
    expect(body.items[1].hasVoted).toBe(false);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it('returns hasVoted as false for unauthenticated users', async () => {
    mockAuth.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PUBLIC', userId: 'other-user' });
    const now = new Date('2025-01-01T00:00:00Z');
    mockInteractionFindMany.mockResolvedValue([
      {
        id: 'q-1',
        question: 'A question',
        answer: 'An answer',
        timestamp: 10,
        upvoteCount: 1,
        createdAt: now,
        user: { id: 'user-2', name: 'Alice', image: null, handle: 'alice' },
      },
    ]);
    mockInteractionCount.mockResolvedValue(1);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0].hasVoted).toBe(false);
    expect(mockInteractionVoteFindMany).not.toHaveBeenCalled();
  });

  it('respects pagination parameters', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PUBLIC', userId: 'other-user' });
    mockInteractionFindMany.mockResolvedValue([]);
    mockInteractionCount.mockResolvedValue(50);

    const response = await GET(createRequest({ page: '3', limit: '10' }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.page).toBe(3);
    expect(body.limit).toBe(10);
    expect(body.total).toBe(50);
    expect(body.totalPages).toBe(5);
  });

  it('clamps limit to max 50', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PUBLIC', userId: 'other-user' });
    mockInteractionFindMany.mockResolvedValue([]);
    mockInteractionCount.mockResolvedValue(0);

    const response = await GET(createRequest({ limit: '100' }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.limit).toBe(50);
  });
});
