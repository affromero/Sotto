import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock functions at module scope for proper typing
const mockPodcastFindUnique = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockPodcastTagCreateMany = vi.fn();
const mockTransaction = vi.fn();

// Mock auth
const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    podcastTag: {
      createMany: (...args: unknown[]) => mockPodcastTagCreateMany(...args),
    },
    $transaction: (callback: unknown) => mockTransaction(callback),
  },
}));

import { POST } from '@/app/api/podcasts/[podcastId]/fork/route';

function createRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/pod-1/fork');
  return new NextRequest(url, { method: 'POST' });
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
  fileSize: 1024000,
  playCount: 100,
  likeCount: 25,
  forkCount: 5,
  saveCount: 10,
  forkedFromId: null,
  createdAt: new Date('2025-01-10T10:00:00Z'),
  updatedAt: new Date('2025-01-10T10:00:00Z'),
  tags: [
    {
      id: 'pt-1',
      podcastId: 'source-pod-1',
      tagId: 'tag-science',
    },
    {
      id: 'pt-2',
      podcastId: 'source-pod-1',
      tagId: 'tag-tech',
    },
  ],
};

const mockForkedPodcast = {
  id: 'forked-pod-1',
  userId: 'user-1',
  title: 'Fork of Quantum Computing 101',
  topic: 'An introduction to quantum computing principles',
  status: 'PENDING',
  visibility: 'PUBLIC',
  audioUrl: null,
  duration: null,
  fileSize: null,
  playCount: 0,
  likeCount: 0,
  forkCount: 0,
  saveCount: 0,
  forkedFromId: 'source-pod-1',
  createdAt: new Date('2025-01-15T12:00:00Z'),
  updatedAt: new Date('2025-01-15T12:00:00Z'),
  user: {
    id: 'user-1',
    name: 'Alice',
    image: 'https://example.com/alice.jpg',
  },
  tags: [
    {
      id: 'pt-3',
      podcastId: 'forked-pod-1',
      tagId: 'tag-science',
      tag: { id: 'tag-science', name: 'Science', slug: 'science' },
    },
    {
      id: 'pt-4',
      podcastId: 'forked-pod-1',
      tagId: 'tag-tech',
      tag: { id: 'tag-tech', name: 'Technology', slug: 'technology' },
    },
  ],
};

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
    expect(mockPodcastFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when source podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
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

  it('successfully creates a fork with correct data structure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    // Mock transaction to execute callback
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: mockPodcastCreate,
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    mockPodcastCreate.mockResolvedValue({
      id: 'forked-pod-1',
      userId: 'user-1',
      title: 'Fork of Quantum Computing 101',
      topic: 'An introduction to quantum computing principles',
      status: 'PENDING',
      forkedFromId: 'source-pod-1',
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBe('forked-pod-1');
    expect(body.title).toBe('Fork of Quantum Computing 101');
    expect(body.topic).toBe('An introduction to quantum computing principles');
    expect(body.status).toBe('PENDING');
    expect(body.forkedFromId).toBe('source-pod-1');
  });

  it('creates fork with prefixed title "Fork of"', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: mockPodcastCreate,
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    mockPodcastCreate.mockResolvedValue({
      id: 'forked-pod-1',
      title: 'Fork of Quantum Computing 101',
      topic: mockSourcePodcast.topic,
      userId: 'user-1',
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Fork of Quantum Computing 101',
        topic: 'An introduction to quantum computing principles',
        status: 'PENDING',
        forkedFromId: 'source-pod-1',
        remixNote: null,
      },
    });
  });

  it('copies topic from source podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: mockPodcastCreate,
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          topic: 'An introduction to quantum computing principles',
        }),
      })
    );
  });

  it('sets forkedFromId to source podcast ID', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: mockPodcastCreate,
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          forkedFromId: 'source-pod-1',
        }),
      })
    );
  });

  it('sets fork status to PENDING', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: mockPodcastCreate,
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
        }),
      })
    );
  });

  it('copies tags from source podcast to fork', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: vi.fn().mockResolvedValue({ id: 'forked-pod-1' }),
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastTagCreateMany).toHaveBeenCalledWith({
      data: [
        { podcastId: 'forked-pod-1', tagId: 'tag-science' },
        { podcastId: 'forked-pod-1', tagId: 'tag-tech' },
      ],
    });
  });

  it('does not copy tags when source has no tags', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({
      ...mockSourcePodcast,
      tags: [],
    });

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: vi.fn().mockResolvedValue({ id: 'forked-pod-1' }),
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastTagCreateMany).not.toHaveBeenCalled();
  });

  it('increments source podcast fork count', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: vi.fn().mockResolvedValue({ id: 'forked-pod-1' }),
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'source-pod-1' },
      data: { forkCount: { increment: 1 } },
    });
  });

  it('returns forked podcast with user and tags included', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: vi.fn().mockResolvedValue({ id: 'forked-pod-1' }),
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    const body = await response.json();

    expect(body.user).toEqual({
      id: 'user-1',
      name: 'Alice',
      image: 'https://example.com/alice.jpg',
    });
    expect(body.tags).toHaveLength(2);
    expect(body.tags[0].tag.slug).toBe('science');
    expect(body.tags[1].tag.slug).toBe('technology');
  });

  it('allows user to fork their own podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'creator-user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: vi.fn().mockResolvedValue({ id: 'forked-pod-1' }),
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue({
            ...mockForkedPodcast,
            userId: 'creator-user-1',
          }),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.userId).toBe('creator-user-1');
  });

  it('uses transaction for atomicity of fork creation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: vi.fn().mockResolvedValue({ id: 'forked-pod-1' }),
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it('assigns fork to authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'specific-user-123' } });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          create: mockPodcastCreate,
          update: mockPodcastUpdate,
          findUnique: vi.fn().mockResolvedValue(mockForkedPodcast),
        },
        podcastTag: {
          createMany: mockPodcastTagCreateMany,
        },
      };
      return callback(tx);
    });

    const request = createRequest();
    await POST(request, {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockPodcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'specific-user-123',
        }),
      })
    );
  });
});
