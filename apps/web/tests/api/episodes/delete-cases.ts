import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

type DeleteEpisode = typeof import('@/app/api/v1/episodes/[episodeId]/route').DELETE;

function createDeleteRequest(path: string): NextRequest {
  const url = new URL(path, 'http://localhost:3000');
  return new NextRequest(url, {
    method: 'DELETE',
  });
}

export function episodeDeleteCases(
  fixture: () => {
    deleteEpisode: DeleteEpisode;
    mockAuthenticateRequest: Mock;
    mockEpisodeFindUnique: Mock;
    mockEpisodeUpdate: Mock;
    mockEpisode: object;
  }
) {
  describe('DELETE /api/v1/episodes/[episodeId]', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns 401 when not authenticated', async () => {
      const { deleteEpisode, mockAuthenticateRequest } = fixture();
      mockAuthenticateRequest.mockResolvedValue(null);

      const request = createDeleteRequest('/api/v1/episodes/pod-1');
      const response = await deleteEpisode(request, {
        params: Promise.resolve({ episodeId: 'pod-1' }),
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toMatchObject({ error: 'Unauthorized' });
    });

    it('returns 404 when episode not found', async () => {
      const { deleteEpisode, mockAuthenticateRequest, mockEpisodeFindUnique } = fixture();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue(null);

      const request = createDeleteRequest('/api/v1/episodes/pod-999');
      const response = await deleteEpisode(request, {
        params: Promise.resolve({ episodeId: 'pod-999' }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toMatchObject({ error: 'Episode not found' });
    });

    it('returns 403 when user is not the owner', async () => {
      const { deleteEpisode, mockAuthenticateRequest, mockEpisodeFindUnique } = fixture();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-2' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });

      const request = createDeleteRequest('/api/v1/episodes/pod-1');
      const response = await deleteEpisode(request, {
        params: Promise.resolve({ episodeId: 'pod-1' }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toMatchObject({ error: 'Forbidden' });
    });

    it('soft-deletes episode when user is owner', async () => {
      const {
        deleteEpisode,
        mockAuthenticateRequest,
        mockEpisodeFindUnique,
        mockEpisodeUpdate,
        mockEpisode,
      } = fixture();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeUpdate.mockResolvedValue(mockEpisode);

      const request = createDeleteRequest('/api/v1/episodes/pod-1');
      const response = await deleteEpisode(request, {
        params: Promise.resolve({ episodeId: 'pod-1' }),
      });

      expect(response.status).toBe(204);
      expect(mockEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'pod-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
}
