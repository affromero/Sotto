import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockSaveFindUnique = vi.fn();
const mockSaveCreate = vi.fn();
const mockSaveDelete = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    save: {
      findUnique: (...args: unknown[]) => mockSaveFindUnique(...args),
      create: (...args: unknown[]) => mockSaveCreate(...args),
      delete: (...args: unknown[]) => mockSaveDelete(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { POST, DELETE } from '@/app/api/podcasts/[podcastId]/save/route';
import { auth } from '@/lib/auth';

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = {
  save: {
    findUnique: mockSaveFindUnique,
    create: mockSaveCreate,
    delete: mockSaveDelete,
  },
  podcast: {
    findUnique: mockPodcastFindUnique,
    update: mockPodcastUpdate,
  },
  $transaction: mockTransaction,
};

function createRequest(podcastId: string): NextRequest {
  const url = new URL(`http://localhost:3000/api/podcasts/${podcastId}/save`);
  return new NextRequest(url, { method: 'POST' });
}

const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
};

const mockPodcast = {
  id: 'pod-1',
  userId: 'user-456',
  title: 'Test Podcast',
  topic: 'Test topic',
  status: 'READY',
  visibility: 'PUBLIC',
  saveCount: 5,
};

const mockSave = {
  id: 'save-1',
  userId: 'user-123',
  podcastId: 'pod-1',
  createdAt: new Date('2025-01-15T10:00:00Z'),
};

describe('POST /api/podcasts/[podcastId]/save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('pod-1');
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 if session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {}, expires: '' });

    const request = createRequest('pod-1');
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 if podcast does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.podcast.findUnique.mockResolvedValue(null);

    const request = createRequest('pod-nonexistent');
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'pod-nonexistent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns saved: true if already saved (idempotent)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcast);
    mockPrisma.save.findUnique.mockResolvedValue(mockSave);

    const request = createRequest('pod-1');
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: true });
  });

  it('creates save and increments saveCount in transaction when not already saved', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcast);
    mockPrisma.save.findUnique.mockResolvedValue(null);

    const mockTx = {
      save: { create: vi.fn().mockResolvedValue(mockSave) },
      podcast: { update: vi.fn().mockResolvedValue({ ...mockPodcast, saveCount: 6 }) },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx);
    });

    const request = createRequest('pod-1');
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: true });
  });

  it('handles different user saving different podcast', async () => {
    const differentSession = {
      user: {
        id: 'user-789',
        email: 'other@example.com',
        name: 'Other User',
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };

    mockAuth.mockResolvedValue(differentSession);
    mockPrisma.podcast.findUnique.mockResolvedValue({ ...mockPodcast, id: 'pod-2' });
    mockPrisma.save.findUnique.mockResolvedValue(null);

    const mockTx = {
      save: {
        create: vi.fn().mockResolvedValue({ ...mockSave, userId: 'user-789', podcastId: 'pod-2' }),
      },
      podcast: { update: vi.fn().mockResolvedValue({ ...mockPodcast, id: 'pod-2', saveCount: 1 }) },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx);
    });

    const request = createRequest('pod-2');
    const response = await POST(request, {
      params: Promise.resolve({ podcastId: 'pod-2' }),
    });

    expect(response.status).toBe(200);
  });
});

describe('DELETE /api/podcasts/[podcastId]/save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('pod-1');
    const response = await DELETE(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 if session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {}, expires: '' });

    const request = createRequest('pod-1');
    const response = await DELETE(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns saved: false if save does not exist (idempotent)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.save.findUnique.mockResolvedValue(null);

    const request = createRequest('pod-1');
    const response = await DELETE(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: false });
  });

  it('deletes save and decrements saveCount in transaction when save exists', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrisma.save.findUnique.mockResolvedValue(mockSave);

    const mockTx = {
      save: { delete: vi.fn().mockResolvedValue(mockSave) },
      podcast: { update: vi.fn().mockResolvedValue({ ...mockPodcast, saveCount: 4 }) },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx);
    });

    const request = createRequest('pod-1');
    const response = await DELETE(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: false });
  });

  it('handles different user unsaving podcast', async () => {
    const differentSession = {
      user: {
        id: 'user-999',
        email: 'another@example.com',
        name: 'Another User',
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };

    mockAuth.mockResolvedValue(differentSession);
    mockPrisma.save.findUnique.mockResolvedValue({ ...mockSave, userId: 'user-999' });

    const mockTx = {
      save: { delete: vi.fn().mockResolvedValue({ ...mockSave, userId: 'user-999' }) },
      podcast: { update: vi.fn().mockResolvedValue({ ...mockPodcast, saveCount: 4 }) },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx);
    });

    const request = createRequest('pod-1');
    const response = await DELETE(request, {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
  });

});
