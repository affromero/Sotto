import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePodcast } from '@/lib/hooks/usePodcast';
import { PodcastDetail } from '@/types/podcast';

const mockPodcastData: PodcastDetail = {
  id: 'podcast-123',
  title: 'Test Podcast',
  topic: 'Testing',
  status: 'READY',
  audioUrl: 'https://example.com/audio.mp3',
  pdfUrl: null,
  duration: 600,
  visibility: 'PUBLIC',
  createdAt: '2024-01-01T00:00:00Z',
  source: 'WEB' as const,
  isHumanContent: false,
  forkedFromId: null,
  ownerIsPro: false,
  remixNote: null,
  failureReason: null,
  currentVersion: 1,
  user: {
    id: 'user-1',
    name: 'Test User',
    image: null,
    handle: null,
  },
  isLiked: false,
  isSaved: false,
  likeCount: 10,
  saveCount: 5,
  forkCount: 2,
  playCount: 100,
  commentCount: 0,
  segments: [],
  references: [],
  tags: [],
  forkedFrom: null,
  forks: [],
  versions: [],
  interactions: [],
  voiceTracks: [],
  defaultVoiceTrackId: null,
};

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePodcast', () => {
  describe('initial fetch', () => {
    it('starts with loading state', () => {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
      const { result } = renderHook(() => usePodcast('podcast-123'));
      expect(result.current.isLoading).toBe(true);
      expect(result.current.podcast).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('fetches podcast data successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockPodcastData,
      } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.podcast).toEqual(mockPodcastData);
      expect(result.current.error).toBeNull();
      expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-123');
    });

    it('handles 404 errors with specific message', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const { result } = renderHook(() => usePodcast('podcast-404'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.podcast).toBeNull();
      expect(result.current.error).toBe('Podcast not found');
    });

    it('handles generic fetch errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const { result } = renderHook(() => usePodcast('podcast-500'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.podcast).toBeNull();
      expect(result.current.error).toBe('Failed to fetch podcast');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => usePodcast('podcast-error'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.podcast).toBeNull();
      expect(result.current.error).toBe('Network error');
    });

    it('refetches when podcastId changes', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockPodcastData,
      } as Response);

      const { rerender } = renderHook(({ id }) => usePodcast(id), {
        initialProps: { id: 'podcast-1' },
      });

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-1');
      });

      rerender({ id: 'podcast-2' });

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-2');
      });
    });

    it('cancels in-flight request on unmount', async () => {
      let resolveRequest: (value: Response) => void;
      vi.mocked(fetch).mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
      );

      const { unmount } = renderHook(() => usePodcast('podcast-123'));
      unmount();

      resolveRequest!({
        ok: true,
        json: async () => mockPodcastData,
      } as Response);

      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });

  describe('like action', () => {
    it('optimistically updates like state', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      act(() => {
        result.current.like();
      });

      expect(result.current.podcast?.isLiked).toBe(true);
      expect(result.current.podcast?.likeCount).toBe(11);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-123/like', {
          method: 'POST',
        });
      });
    });

    it('reverts optimistic update on error', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      await act(async () => {
        await result.current.like();
      });

      await waitFor(() => {
        expect(result.current.podcast?.isLiked).toBe(false);
        expect(result.current.podcast?.likeCount).toBe(10);
      });
    });

    it('does nothing if podcast is null', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const { result } = renderHook(() => usePodcast('podcast-404'));

      await waitFor(() => {
        expect(result.current.podcast).toBeNull();
      });

      await act(async () => {
        await result.current.like();
      });

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('unlike action', () => {
    it('optimistically updates unlike state', async () => {
      const likedPodcast = { ...mockPodcastData, isLiked: true, likeCount: 15 };
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => likedPodcast,
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      act(() => {
        result.current.unlike();
      });

      expect(result.current.podcast?.isLiked).toBe(false);
      expect(result.current.podcast?.likeCount).toBe(14);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-123/like', {
          method: 'DELETE',
        });
      });
    });

    it('reverts optimistic update on error', async () => {
      const likedPodcast = { ...mockPodcastData, isLiked: true, likeCount: 15 };
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => likedPodcast,
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      await act(async () => {
        await result.current.unlike();
      });

      await waitFor(() => {
        expect(result.current.podcast?.isLiked).toBe(true);
        expect(result.current.podcast?.likeCount).toBe(15);
      });
    });
  });

  describe('save action', () => {
    it('optimistically updates save state', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      act(() => {
        result.current.save();
      });

      expect(result.current.podcast?.isSaved).toBe(true);
      expect(result.current.podcast?.saveCount).toBe(6);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-123/save', {
          method: 'POST',
        });
      });
    });

    it('reverts optimistic update on error', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      await act(async () => {
        await result.current.save();
      });

      await waitFor(() => {
        expect(result.current.podcast?.isSaved).toBe(false);
        expect(result.current.podcast?.saveCount).toBe(5);
      });
    });
  });

  describe('unsave action', () => {
    it('optimistically updates unsave state', async () => {
      const savedPodcast = { ...mockPodcastData, isSaved: true, saveCount: 10 };
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => savedPodcast,
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      act(() => {
        result.current.unsave();
      });

      expect(result.current.podcast?.isSaved).toBe(false);
      expect(result.current.podcast?.saveCount).toBe(9);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-123/save', {
          method: 'DELETE',
        });
      });
    });

    it('reverts optimistic update on error', async () => {
      const savedPodcast = { ...mockPodcastData, isSaved: true, saveCount: 10 };
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => savedPodcast,
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      await act(async () => {
        await result.current.unsave();
      });

      await waitFor(() => {
        expect(result.current.podcast?.isSaved).toBe(true);
        expect(result.current.podcast?.saveCount).toBe(10);
      });
    });
  });

  describe('fork action', () => {
    it('returns new podcast ID on success', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'podcast-fork-456' }),
        } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      let forkedId: string | null = null;
      await act(async () => {
        forkedId = await result.current.fork();
      });

      expect(forkedId).toBe('podcast-fork-456');
      expect(fetch).toHaveBeenCalledWith('/api/podcasts/podcast-123/fork', {
        method: 'POST',
      });
    });

    it('updates fork count optimistically', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'podcast-fork-456' }),
        } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      await act(async () => {
        await result.current.fork();
      });

      expect(result.current.podcast?.forkCount).toBe(3);
    });

    it('returns null on error', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      let forkedId: string | null = null;
      await act(async () => {
        forkedId = await result.current.fork();
      });

      expect(forkedId).toBeNull();
    });

    it('returns null on network error', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPodcastData,
        } as Response)
        .mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => usePodcast('podcast-123'));

      await waitFor(() => {
        expect(result.current.podcast).not.toBeNull();
      });

      let forkedId: string | null = null;
      await act(async () => {
        forkedId = await result.current.fork();
      });

      expect(forkedId).toBeNull();
    });
  });
});
