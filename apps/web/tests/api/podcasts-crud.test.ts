import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock functions at module scope for proper typing
const mockPodcastFindMany = vi.fn();
const mockPodcastCount = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockPodcastDelete = vi.fn();
const mockLikeFindUnique = vi.fn();
const mockSaveFindUnique = vi.fn();

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findMany: (...args: unknown[]) => mockPodcastFindMany(...args),
      count: (...args: unknown[]) => mockPodcastCount(...args),
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
      delete: (...args: unknown[]) => mockPodcastDelete(...args),
    },
    like: {
      findUnique: (...args: unknown[]) => mockLikeFindUnique(...args),
    },
    save: {
      findUnique: (...args: unknown[]) => mockSaveFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
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
    delete: mockPodcastDelete,
  },
  like: {
    findUnique: mockLikeFindUnique,
  },
  save: {
    findUnique: mockSaveFindUnique,
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
  likeCount: 10,
  forkCount: 2,
  saveCount: 5,
  forkedFromId: null,
  hostVoiceId: 'voice-host-1',
  expertVoiceId: 'voice-expert-1',
  usePremiumVoice: false,
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
    expect(body).toEqual({ error: 'Unauthorized' });
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

  it('filters podcasts by authenticated user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findMany.mockResolvedValue([]);

    const request = createGetRequest();
    await getList(request);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      include: {
        tags: { include: { tag: true } },
      },
    });
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
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createPostRequest('/api/podcasts', { title: 'Test', topic: 'Test topic' });
    const response = await createPodcast(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('creates podcast with valid data', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });
    mockPrisma.podcast.create.mockResolvedValue({
      ...mockPodcast,
      status: 'PENDING',
    });

    const body = {
      title: 'Quantum Physics 101',
      topic: 'An introduction to quantum mechanics',
    };

    const request = createPostRequest('/api/podcasts', body);
    const response = await createPodcast(request);

    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.id).toBe('pod-1');
    expect(result.title).toBe('Quantum Physics 101');
    expect(result.status).toBe('PENDING');
  });

  it('creates podcast with optional voice IDs', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });
    mockPrisma.podcast.create.mockResolvedValue(mockPodcast);

    const body = {
      title: 'Test Podcast',
      topic: 'Test topic',
      hostVoiceId: 'voice-host-custom',
      expertVoiceId: 'voice-expert-custom',
      usePremiumVoice: true,
    };

    const request = createPostRequest('/api/podcasts', body);
    await createPodcast(request);

    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Test Podcast',
        topic: 'Test topic',
        status: 'PENDING',
        hostVoiceId: 'voice-host-custom',
        expertVoiceId: 'voice-expert-custom',
        usePremiumVoice: true,
        ttsProvider: null,
      },
    });
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

  it('checks rate limit only for Bearer token requests', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() });
    mockPrisma.podcast.create.mockResolvedValue(mockPodcast);

    const body = { title: 'Test', topic: 'Test topic' };
    const request = createPostRequest('/api/podcasts', body, 'Bearer sk_sotto_test123');
    await createPodcast(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('api:create:user-1', 60, 60);
  });

  it('does not check rate limit for session-based auth', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.create.mockResolvedValue(mockPodcast);

    const body = { title: 'Test', topic: 'Test topic' };
    const request = createPostRequest('/api/podcasts', body);
    await createPodcast(request);

    expect(mockCheckRateLimit).not.toHaveBeenCalled();
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
    expect(body).toEqual({ error: 'Podcast not found' });
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
    expect(body.isLiked).toBe(false);
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
    expect(body).toEqual({ error: 'Not found' });
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
    mockLikeFindUnique.mockResolvedValue(null);
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
    mockLikeFindUnique.mockResolvedValue(null);
    mockSaveFindUnique.mockResolvedValue(null);

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
  });

  it('includes isLiked=true when user has liked the podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcastWithRelations);
    mockLikeFindUnique.mockResolvedValue({
      userId: 'user-1',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });
    mockSaveFindUnique.mockResolvedValue(null);

    const request = createGetRequest('/api/podcasts/pod-1');
    const response = await getPodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(body.isLiked).toBe(true);
    expect(body.isSaved).toBe(false);
  });

  it('includes isSaved=true when user has saved the podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcastWithRelations);
    mockLikeFindUnique.mockResolvedValue(null);
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

    expect(body.isLiked).toBe(false);
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createPatchRequest('/api/podcasts/pod-1', { title: 'Updated' });
    const response = await updatePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unauthorized' });
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
    expect(body).toEqual({ error: 'Podcast not found' });
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
    expect(body).toEqual({ error: 'Forbidden' });
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
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { title: 'Updated Title' },
      include: {
        user: { select: { id: true, name: true, image: true } },
        tags: { include: { tag: true } },
      },
    });
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

  it('updates podcast visibility', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.update.mockResolvedValue({
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
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: {
        title: 'New Title',
        topic: 'New Topic',
        visibility: 'UNLISTED',
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
        tags: { include: { tag: true } },
      },
    });
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
    expect(body).toEqual({ error: 'Unauthorized' });
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
    expect(body).toEqual({ error: 'Podcast not found' });
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
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('deletes podcast when user is owner', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.delete.mockResolvedValue(mockPodcast);

    const request = createDeleteRequest('/api/podcasts/pod-1');
    const response = await deletePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(204);
    expect(mockPrisma.podcast.delete).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
    });
  });

  it('returns 204 with no content on successful deletion', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.delete.mockResolvedValue(mockPodcast);

    const request = createDeleteRequest('/api/podcasts/pod-1');
    const response = await deletePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(204);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('checks ownership before deletion', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.delete.mockResolvedValue(mockPodcast);

    const request = createDeleteRequest('/api/podcasts/pod-1');
    await deletePodcast(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(mockPrisma.podcast.findUnique).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      select: { userId: true },
    });
  });
});
