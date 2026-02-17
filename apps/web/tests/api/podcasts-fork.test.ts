import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock functions at module scope for proper typing
const mockPodcastFindUnique = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockPodcastTagCreateMany = vi.fn();
const mockDiscoveryCreate = vi.fn();
const mockTransaction = vi.fn();

// Mock auth
const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() { return this.prisma; },
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    podcastTag: {
      createMany: (...args: unknown[]) => mockPodcastTagCreateMany(...args),
    },
    discovery: {
      create: (...args: unknown[]) => mockDiscoveryCreate(...args),
    },
    activity: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
    $transaction: (callback: unknown) => mockTransaction(callback),
  },
}));

// Mock queue
const mockAddJob = vi.fn();
vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: 'content-extraction-queue',
  notificationQueue: 'notification-queue',
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    EXTRACT_CONTENT: 'EXTRACT_CONTENT',
    SEND_NOTIFICATION: 'SEND_NOTIFICATION',
  },
}));

// Mock generation gate
const mockCheckGenerationGate = vi.fn();
const mockTryIncrementFreeGeneration = vi.fn();
vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: (...args: unknown[]) => mockCheckGenerationGate(...args),
  tryIncrementFreeGeneration: (...args: unknown[]) => mockTryIncrementFreeGeneration(...args),
}));

const mockGetFreeTierConfig = vi.fn();
vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: (...args: unknown[]) => mockGetFreeTierConfig(...args),
}));

// Mock validations — let real schema through
vi.mock('@/lib/validations', async () => {
  const actual = await vi.importActual('@/lib/validations');
  return actual;
});

import { POST } from '@/app/api/podcasts/[podcastId]/fork/route';

function createRequest(body: Record<string, unknown> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/pod-1/fork');
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockSourcePodcast = {
  id: 'source-pod-1',
  userId: 'creator-user-1',
  title: 'Quantum Computing 101',
  topic: 'An introduction to quantum computing principles',
  status: 'READY',
  visibility: 'PUBLIC',
  audioUrl: 'https://r2.example.com/audio/source.mp3',
  duration: 600,
  forkCount: 5,
  forkedFromId: null,
  tags: [{ tagId: 'tag-science' }, { tagId: 'tag-tech' }],
  discovery: {
    durationTarget: 10,
    audienceLevel: 'intermediate',
    audience: 'general',
    depth: 'standard',
    tone: 'casual',
    focusAreas: ['qubits'],
  },
  script: {
    markdown: '# Quantum Computing\n\nSome content...',
  },
  user: {
    name: 'Creator',
  },
};

function setupSuccessMocks(userId = 'user-1') {
  mockAuth.mockResolvedValue({ user: { id: userId, name: 'Alice' } });
  mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
  mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);
  mockAddJob.mockResolvedValue(undefined);
  mockPodcastUpdate.mockResolvedValue({});

  mockTransaction.mockImplementation(async (callback) => {
    const tx = {
      podcast: {
        create: mockPodcastCreate,
        update: mockPodcastUpdate,
      },
      discovery: {
        create: mockDiscoveryCreate,
      },
      podcastTag: {
        createMany: mockPodcastTagCreateMany,
      },
    };
    return callback(tx);
  });

  mockPodcastCreate.mockResolvedValue({
    id: 'forked-pod-1',
    userId,
    title: 'Fork of Quantum Computing 101',
    topic: 'An introduction to quantum computing principles',
    status: 'PENDING',
    forkedFromId: 'source-pod-1',
  });
  mockDiscoveryCreate.mockResolvedValue({ id: 'discovery-1' });
}

describe('POST /api/podcasts/[podcastId]/fork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when source podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'nonexistent-pod' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Podcast not found');
  });

  it('returns 403 when source podcast is not PUBLIC', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue({
      ...mockSourcePodcast,
      visibility: 'PRIVATE',
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Only public podcasts can be forked');
  });

  it('returns 403 when source podcast is UNLISTED', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue({
      ...mockSourcePodcast,
      visibility: 'UNLISTED',
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Only public podcasts can be forked');
  });

  it('returns 400 when source podcast status is not READY', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue({
      ...mockSourcePodcast,
      status: 'PENDING',
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Only podcasts with READY status can be forked');
  });

  it('returns 400 when source podcast is GENERATING_AUDIO', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue({
      ...mockSourcePodcast,
      status: 'GENERATING_AUDIO',
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Only podcasts with READY status can be forked');
  });

  it('successfully creates a fork and returns id', async () => {
    setupSuccessMocks();

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe('forked-pod-1');
  });


  it('enqueues content extraction after fork creation', async () => {
    setupSuccessMocks();

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockAddJob).toHaveBeenCalledWith(
      'content-extraction-queue',
      'EXTRACT_CONTENT',
      expect.objectContaining({
        podcastId: 'forked-pod-1',
        userId: 'user-1',
      })
    );
  });

  it('sends notification to source podcast owner', async () => {
    setupSuccessMocks();

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockAddJob).toHaveBeenCalledWith(
      'notification-queue',
      'SEND_NOTIFICATION',
      expect.objectContaining({
        userId: 'creator-user-1',
        type: 'PODCAST_FORKED',
      })
    );
  });

  it('does not notify when user forks their own podcast', async () => {
    setupSuccessMocks('creator-user-1');

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    // Only content extraction job, no notification
    expect(mockAddJob).toHaveBeenCalledTimes(1);
    expect(mockAddJob).toHaveBeenCalledWith(
      'content-extraction-queue',
      'EXTRACT_CONTENT',
      expect.anything()
    );
  });

  it('allows user to fork their own podcast', async () => {
    setupSuccessMocks('creator-user-1');
    mockPodcastCreate.mockResolvedValue({
      id: 'forked-pod-1',
      userId: 'creator-user-1',
      title: 'Fork of Quantum Computing 101',
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(201);
  });

});
