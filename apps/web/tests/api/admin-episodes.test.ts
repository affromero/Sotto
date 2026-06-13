import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockEpisodeUpdate = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
    },
  },
  prismaUnfiltered: {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
    },
  },
}));

import { DELETE } from '@/app/api/v1/admin/episodes/[episodeId]/route';

function createDeleteRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/admin/episodes/pod-1'), {
    method: 'DELETE',
  });
}

async function createParams(episodeId: string) {
  return { params: Promise.resolve({ episodeId }) };
}

describe('DELETE /api/v1/admin/episodes/[episodeId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 404 when episode not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockEpisodeFindUnique.mockResolvedValue(null);

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Episode not found' });
  });

  it('returns 409 when episode already deleted', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockEpisodeFindUnique.mockResolvedValue({
      deletedAt: new Date(),
    });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: 'Episode already deleted' });
  });

  it('soft-deletes episode', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockEpisodeFindUnique.mockResolvedValue({
      deletedAt: null,
    });
    mockEpisodeUpdate.mockResolvedValue({ id: 'pod-1' });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockEpisodeUpdate).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
