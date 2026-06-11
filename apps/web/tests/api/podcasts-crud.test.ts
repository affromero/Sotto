import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock functions at module scope for proper typing
const mockPodcastFindMany = vi.fn();
const mockPodcastCount = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockSaveFindUnique = vi.fn();
const mockDiscoveryCreate = vi.fn();

const mockGetAutoModelConfig = vi.fn();
const mockAddJob = vi.fn();

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserFindUniqueOrThrow = vi.fn();

vi.mock('@/lib/prisma', () => {
  const txProxy = {
    podcast: {
      findMany: (...args: unknown[]) => mockPodcastFindMany(...args),
      count: (...args: unknown[]) => mockPodcastCount(...args),
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    save: {
      findUnique: (...args: unknown[]) => mockSaveFindUnique(...args),
    },
    discovery: {
      create: (...args: unknown[]) => mockDiscoveryCreate(...args),
    },
    activity: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
    },
  };
  return { prisma: txProxy, prismaUnfiltered: txProxy };
});

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  getPodcastCacheTtl: vi.fn().mockReturnValue(30),
  invalidatePodcastCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: 'content-extraction-queue',
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { EXTRACT_CONTENT: 'EXTRACT_CONTENT' },
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
}));

vi.mock('@/lib/voice-pricing', () => ({
  computeVoiceCharges: vi.fn().mockResolvedValue([]),
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
    voiceCloningEnabled: true,
  }),
  getJobPriority: vi.fn().mockReturnValue(1),
}));

vi.mock('@/lib/byok', () => ({
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/r2', () => ({
  resolveAudioUrl: vi.fn(async (url: string | null) => url),
}));

vi.mock('@/lib/auth-guards', () => ({
  checkSuspension: vi.fn().mockReturnValue(null),
  requireAdmin: vi.fn().mockReturnValue(null),
}));

import { GET as getList, POST as createPodcast } from '@/app/api/podcasts/route';
import {
  GET as getPodcast,
  PATCH as updatePodcast,
  DELETE as deletePodcast,
} from '@/app/api/podcasts/[podcastId]/route';

const mockPrisma = {
  podcast: {
    findMany: mockPodcastFindMany,
    count: mockPodcastCount,
    create: mockPodcastCreate,
    findUnique: mockPodcastFindUnique,
    update: mockPodcastUpdate,
  },
  save: {
    findUnique: mockSaveFindUnique,
  },
  discovery: {
    create: mockDiscoveryCreate,
  },
};

function createGetRequest(path = '/api/podcasts'): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  return new NextRequest(url);
}

function createPostRequest(path: string, body: unknown, authHeader?: string): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (authHeader) {
    headers.authorization = authHeader;
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function createPatchRequest(path: string, body: unknown): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(path: string): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  return new NextRequest(url, {
    method: 'DELETE',
  });
}

const mockPodcast = {
  id: 'pod-1',
  userId: 'user-1',
  title: 'Quantum Physics 101',
  topic: 'An introduction to quantum mechanics',
  status: 'READY',
  visibility: 'PUBLIC',
  audioUrl: 'https://r2.example.com/audio/pod-1.mp3',
  duration: 600,
  fileSize: 1024000,
  playCount: 42,
  saveCount: 5,
  hostVoiceId: 'voice-host-1',
  expertVoiceId: 'voice-expert-1',
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
  tags: [
    {
      id: 'pt-1',
      podcastId: 'pod-1',
      tagId: 'tag-1',
      tag: { id: 'tag-1', name: 'Science', slug: 'science' },
    },
  ],
};

const explicitTtsSelection = {
  ttsProvider: 'openai',
  ttsModel: 'tts-1-hd',
};

const mockPodcastWithRelations = {
  ...mockPodcast,
  user: { id: 'user-1', name: 'Alice', image: 'https://example.com/alice.jpg' },
  segments: [
    {
      id: 'seg-1',
      podcastId: 'pod-1',
      order: 0,
      speaker: 'HOST',
      text: 'Welcome to quantum physics',
      audioUrl: 'https://r2.example.com/segments/seg-1.mp3',
      duration: 10,
    },
  ],
  interactions: [],
};

describe('GET /api/podcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createGetRequest();
    const response = await getList(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns user podcasts with tags', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);

    const request = createGetRequest();
    const response = await getList(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('pod-1');
    expect(body[0].tags).toHaveLength(1);
  });

  it('orders podcasts by createdAt desc', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    const pod1 = { ...mockPodcast, id: 'pod-1', createdAt: new Date('2025-01-15') };
    const pod2 = { ...mockPodcast, id: 'pod-2', createdAt: new Date('2025-01-16') };
    mockPrisma.podcast.findMany.mockResolvedValue([pod2, pod1]);

    const request = createGetRequest();
    const response = await getList(request);
    const body = await response.json();

    expect(body[0].id).toBe('pod-2');
    expect(body[1].id).toBe('pod-1');
  });

  it('returns empty array when user has no podcasts', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findMany.mockResolvedValue([]);

    const request = createGetRequest();
    const response = await getList(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('POST /api/podcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ preferredAiModel: null });
    mockGetAutoModelConfig.mockResolvedValue({
      model: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        ttsProvider: 'openai',
        ttsModel: 'tts-1-hd',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
      },
      platform: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
      },
    });
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createPostRequest('/api/podcasts', { title: 'Test', topic: 'Test topic' });
    const response = await createPodcast(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('creates podcast and queues extraction pipeline', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });
    mockDiscoveryCreate.mockResolvedValue({ id: 'disc-1' });
    mockAddJob.mockResolvedValue(undefined);
    mockPrisma.podcast.create.mockResolvedValue({
      ...mockPodcast,
      status: 'EXTRACTING',
    });

    const body = {
      title: 'Quantum Physics 101',
      topic: 'An introduction to quantum mechanics',
      ...explicitTtsSelection,
    };

    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.id).toBe('pod-1');
    expect(result.status).toBe('EXTRACTING');
    expect(mockPodcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visibility: 'PRIVATE', ...explicitTtsSelection }),
      })
    );
  });

  it('auto-resolves TTS provider when none is explicit', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });
    mockDiscoveryCreate.mockResolvedValue({ id: 'disc-1' });
    mockAddJob.mockResolvedValue(undefined);
    mockPrisma.podcast.create.mockResolvedValue({
      ...mockPodcast,
      status: 'EXTRACTING',
      ttsProvider: 'openai',
      ttsModel: 'tts-1-hd',
    });

    const request = createPostRequest('/api/podcasts', {
      title: 'Quantum Physics 101',
      topic: 'An introduction to quantum mechanics',
    });
    const response = await createPodcast(request);

    expect(response.status).toBe(201);
    expect(mockPodcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ttsProvider: 'openai',
          ttsModel: 'tts-1-hd',
          ttsAutoResolved: true,
        }),
      }),
    );
  });

  it('creates podcast with optional voice IDs', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });
    mockDiscoveryCreate.mockResolvedValue({ id: 'disc-1' });
    mockAddJob.mockResolvedValue(undefined);
    mockPrisma.podcast.create.mockResolvedValue(mockPodcast);

    const body = {
      title: 'Test Podcast',
      topic: 'Test topic',
      ...explicitTtsSelection,
      hostVoiceId: 'voice-host-custom',
      expertVoiceId: 'voice-expert-custom',
    };

    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.id).toBe('pod-1');
  });

  it('returns 400 when title is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });

    const body = { topic: 'Test topic' };
    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result).toHaveProperty('error');
  });

  it('returns 400 when topic is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });

    const body = { title: 'Test Podcast' };
    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result).toHaveProperty('error');
  });

  it('returns 400 when title exceeds 200 characters', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });

    const body = {
      title: 'a'.repeat(201),
      topic: 'Test topic',
    };

    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when topic exceeds 5000 characters', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });

    const body = {
      title: 'Test',
      topic: 'a'.repeat(5001),
    };

    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when title is empty string', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });

    const body = {
      title: '',
      topic: 'Test topic',
    };

    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(400);
  });

  it('returns 429 when rate limit exceeded for API key', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
    });

    const body = { title: 'Test', topic: 'Test topic' };
    const request = createPostRequest('/api/podcasts', body, 'Bearer sk_sotto_test123');
    const response = await createPodcast(request);

    expect(response.status).toBe(429);
    const result = await response.json();
    expect(result).toHaveProperty('error', 'Rate limit exceeded');
    expect(result).toHaveProperty('resetAt');
  });
});

describe('GET /api/podcasts/[podcastId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when podcast not found', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(null);

    const request = createGetRequest('/api/podcasts/pod-999');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-999' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns public podcast without authentication', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcastWithRelations);

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('pod-1');
    expect(body).not.toHaveProperty('isLiked');
    expect(body.isSaved).toBe(false);
  });

  it('returns 404 for private podcast when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue({
      ...mockPodcastWithRelations,
      visibility: 'PRIVATE',
    });

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Not found' });
  });

  it('returns 404 for private podcast when authenticated as different user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-2' });
    mockPrisma.podcast.findUnique.mockResolvedValue({
      ...mockPodcastWithRelations,
      visibility: 'PRIVATE',
    });

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(404);
  });

  it('returns private podcast when authenticated as owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({
      ...mockPodcastWithRelations,
      visibility: 'PRIVATE',
    });
    mockSaveFindUnique.mockResolvedValue(null);

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('pod-1');
  });

  it('returns unlisted podcast when authenticated as owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({
      ...mockPodcastWithRelations,
      visibility: 'UNLISTED',
    });
    mockSaveFindUnique.mockResolvedValue(null);

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
  });

  it('includes isSaved=true when user has saved the podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcastWithRelations);
    mockSaveFindUnique.mockResolvedValue({
      userId: 'user-1',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(body).not.toHaveProperty('isLiked');
    expect(body.isSaved).toBe(true);
  });

  it('includes user, tags, segments, and interactions', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcastWithRelations);

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(body.user).toEqual({
      id: 'user-1',
      name: 'Alice',
      image: 'https://example.com/alice.jpg',
    });
    expect(body.tags).toHaveLength(1);
    expect(body.segments).toHaveLength(1);
    expect(body.interactions).toEqual([]);
  });
});

describe('PATCH /api/podcasts/[podcastId]', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER' });
    const { getGenerationFeatures } = await import('@/lib/generation-features');
    (getGenerationFeatures as ReturnType<typeof vi.fn>).mockReturnValue({
      maxDurationMinutes: 30,
      maxSpeakers: 4,
      autoApproveScript: false,
      webSearchEnabled: true,
      maxQaInteractions: Infinity,
      privateAllowed: true,
      priorityQueue: true,
      analyticsEnabled: true,
      voiceCloningEnabled: true,
    });
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createPatchRequest('/api/podcasts/pod-1', { title: 'Updated' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue(null);

    const request = createPatchRequest('/api/podcasts/pod-999', { title: 'Updated' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-999' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user is not the owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-2' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest('/api/podcasts/pod-1', { title: 'Updated' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('updates podcast title when owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.update.mockResolvedValue({
      ...mockPodcastWithRelations,
      title: 'Updated Title',
    });

    const request = createPatchRequest('/api/podcasts/pod-1', { title: 'Updated Title' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.title).toBe('Updated Title');
  });

  it('updates podcast topic', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.update.mockResolvedValue({
      ...mockPodcastWithRelations,
      topic: 'Updated topic',
    });

    const request = createPatchRequest('/api/podcasts/pod-1', { topic: 'Updated topic' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.topic).toBe('Updated topic');
  });

  it('updates podcast visibility to PRIVATE for Pro user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER' });
    mockPodcastUpdate.mockResolvedValue({
      ...mockPodcastWithRelations,
      visibility: 'PRIVATE',
    });

    const request = createPatchRequest('/api/podcasts/pod-1', { visibility: 'PRIVATE' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.visibility).toBe('PRIVATE');
  });

  it('updates podcast visibility to PRIVATE for free tier user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockPodcastUpdate.mockResolvedValue({
      ...mockPodcastWithRelations,
      visibility: 'PRIVATE',
    });

    const request = createPatchRequest('/api/podcasts/pod-1', { visibility: 'PRIVATE' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.visibility).toBe('PRIVATE');
  });

  it('updates podcast visibility to UNLISTED for free tier user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockPodcastUpdate.mockResolvedValue({
      ...mockPodcastWithRelations,
      visibility: 'UNLISTED',
    });

    const request = createPatchRequest('/api/podcasts/pod-1', { visibility: 'UNLISTED' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.visibility).toBe('UNLISTED');
  });

  it('returns 400 for invalid visibility value', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest('/api/podcasts/pod-1', { visibility: 'INVALID' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 when title exceeds 200 characters', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest('/api/podcasts/pod-1', { title: 'a'.repeat(201) });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 when title is empty string', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest('/api/podcasts/pod-1', { title: '' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(400);
  });

  it('updates multiple fields at once', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.update.mockResolvedValue({
      ...mockPodcastWithRelations,
      title: 'New Title',
      topic: 'New Topic',
      visibility: 'UNLISTED',
    });

    const request = createPatchRequest('/api/podcasts/pod-1', {
      title: 'New Title',
      topic: 'New Topic',
      visibility: 'UNLISTED',
    });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.title).toBe('New Title');
    expect(body.topic).toBe('New Topic');
    expect(body.visibility).toBe('UNLISTED');
  });
});

describe('DELETE /api/podcasts/[podcastId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createDeleteRequest('/api/podcasts/pod-1');
    const response = await deletePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue(null);

    const request = createDeleteRequest('/api/podcasts/pod-999');
    const response = await deletePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-999' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user is not the owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-2' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createDeleteRequest('/api/podcasts/pod-1');
    const response = await deletePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('soft-deletes podcast when user is owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.update.mockResolvedValue(mockPodcast);

    const request = createDeleteRequest('/api/podcasts/pod-1');
    const response = await deletePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(204);
    expect(mockPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
