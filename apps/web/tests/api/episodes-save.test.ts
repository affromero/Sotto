import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSaveFindUnique = vi.fn();
const mockSaveCreate = vi.fn();
const mockSaveDelete = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    save: {
      findUnique: (...args: unknown[]) => mockSaveFindUnique(...args),
      create: (...args: unknown[]) => mockSaveCreate(...args),
      delete: (...args: unknown[]) => mockSaveDelete(...args),
    },
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { POST, DELETE } from '@/app/api/v1/episodes/[episodeId]/save/route';

function createRequest(episodeId: string, method = 'POST'): NextRequest {
  const url = new URL(`http://localhost:3000/api/v1/episodes/${episodeId}/save`);
  return new NextRequest(url, { method });
}

const mockEpisode = {
  id: 'pod-1',
};

const mockSave = {
  id: 'save-1',
  userId: 'user-123',
  episodeId: 'pod-1',
  createdAt: new Date('2025-01-15T10:00:00Z'),
};

describe('POST /api/v1/episodes/[episodeId]/save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createRequest('pod-1');
    const response = await POST(request, {
      params: Promise.resolve({ episodeId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 if episode does not exist', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(null);

    const request = createRequest('pod-nonexistent');
    const response = await POST(request, {
      params: Promise.resolve({ episodeId: 'pod-nonexistent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Episode not found' });
  });

  it('returns saved: true if already saved (idempotent)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);
    mockSaveFindUnique.mockResolvedValue(mockSave);

    const request = createRequest('pod-1');
    const response = await POST(request, {
      params: Promise.resolve({ episodeId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: true });
    expect(mockSaveCreate).not.toHaveBeenCalled();
  });

  it('creates save when not already saved', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockEpisodeFindUnique.mockResolvedValue(mockEpisode);
    mockSaveFindUnique.mockResolvedValue(null);
    mockSaveCreate.mockResolvedValue(mockSave);

    const request = createRequest('pod-1');
    const response = await POST(request, {
      params: Promise.resolve({ episodeId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: true });
    expect(mockSaveCreate).toHaveBeenCalledWith({
      data: { userId: 'user-123', episodeId: 'pod-1' },
    });
  });

  it('handles different user saving different episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-789' });
    mockEpisodeFindUnique.mockResolvedValue({ id: 'pod-2' });
    mockSaveFindUnique.mockResolvedValue(null);
    mockSaveCreate.mockResolvedValue({ ...mockSave, userId: 'user-789', episodeId: 'pod-2' });

    const request = createRequest('pod-2');
    const response = await POST(request, {
      params: Promise.resolve({ episodeId: 'pod-2' }),
    });

    expect(response.status).toBe(200);
  });
});

describe('DELETE /api/v1/episodes/[episodeId]/save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createRequest('pod-1', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ episodeId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns saved: false if save does not exist (idempotent)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockSaveFindUnique.mockResolvedValue(null);

    const request = createRequest('pod-1', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ episodeId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: false });
    expect(mockSaveDelete).not.toHaveBeenCalled();
  });

  it('deletes save when save exists', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockSaveFindUnique.mockResolvedValue(mockSave);
    mockSaveDelete.mockResolvedValue(mockSave);

    const request = createRequest('pod-1', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ episodeId: 'pod-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ saved: false });
    expect(mockSaveDelete).toHaveBeenCalledWith({
      where: { userId_episodeId: { userId: 'user-123', episodeId: 'pod-1' } },
    });
  });

  it('handles different user unsaving episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-999' });
    mockSaveFindUnique.mockResolvedValue({ ...mockSave, userId: 'user-999' });
    mockSaveDelete.mockResolvedValue({ ...mockSave, userId: 'user-999' });

    const request = createRequest('pod-1', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ episodeId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
  });
});
