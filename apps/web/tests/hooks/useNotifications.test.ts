import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { NotificationData } from '@/types/notification';

const mockNotifications: NotificationData[] = [
  {
    id: 'notif-1',
    type: 'PODCAST_READY',
    title: 'Your podcast is ready',
    message: 'Test Podcast is now available',
    read: false,
    data: { podcastId: 'podcast-1' },
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'notif-2',
    type: 'BRIEFING_READY',
    title: 'Briefing ready',
    message: 'Your daily briefing is ready',
    read: true,
    data: { podcastId: 'podcast-briefing' },
    createdAt: '2024-01-01T01:00:00Z',
  },
  {
    id: 'notif-3',
    type: 'SCRIPT_READY',
    title: 'Script ready',
    message: 'AI Ethics is ready for review',
    read: false,
    data: { podcastId: 'podcast-2' },
    createdAt: '2024-01-01T02:00:00Z',
  },
];

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useNotifications', () => {
  describe('initial fetch', () => {
    it('starts with loading state', () => {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
      const { result } = renderHook(() => useNotifications());
      expect(result.current.isLoading).toBe(true);
      expect(result.current.notifications).toEqual([]);
    });

    it('fetches notifications on mount', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
      } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.notifications).toEqual(mockNotifications);
      expect(fetch).toHaveBeenCalledWith('/api/notifications');
    });

    it('calculates unread count correctly', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
      } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.unreadCount).toBe(2);
      });
    });

    it('handles empty notifications', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ notifications: [], unreadCount: 0, total: 0 }),
      } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.notifications).toEqual([]);
      expect(result.current.unreadCount).toBe(0);
    });

    it('handles fetch error silently', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.notifications).toEqual([]);
    });

    it('handles non-ok response silently', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.notifications).toEqual([]);
    });
  });

  describe('polling', () => {
    it('polls every 30 seconds', async () => {
      vi.useFakeTimers();

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
      } as Response);

      const { result } = renderHook(() => useNotifications());

      // Flush only promises, not timers (initial fetch)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(false);

      // Advance 60 seconds and flush promises
      await act(async () => {
        vi.advanceTimersByTime(60000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledTimes(2);

      // Advance another 60 seconds
      await act(async () => {
        vi.advanceTimersByTime(60000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('clears interval on unmount', async () => {
      vi.useFakeTimers();

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
      } as Response);

      const { unmount } = renderHook(() => useNotifications());

      // Flush only promises (initial fetch)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledTimes(1);

      unmount();

      // Advance timers after unmount - should not trigger more fetches
      act(() => {
        vi.advanceTimersByTime(120000);
      });

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('updates notifications on poll', async () => {
      vi.useFakeTimers();

      const initialNotifications = [mockNotifications[0]];
      const updatedNotifications = mockNotifications;

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: initialNotifications, unreadCount: 1, total: 1 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: updatedNotifications, unreadCount: 2, total: 3 }),
        } as Response);

      const { result } = renderHook(() => useNotifications());

      // Flush only promises (initial fetch)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.notifications).toHaveLength(1);

      // Advance 60 seconds and flush promises
      await act(async () => {
        vi.advanceTimersByTime(60000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.notifications).toHaveLength(3);
    });
  });

  describe('markRead', () => {
    it('optimistically marks notification as read', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(3);
      });

      act(() => {
        result.current.markRead('notif-1');
      });

      const updatedNotif = result.current.notifications.find((n) => n.id === 'notif-1');
      expect(updatedNotif?.read).toBe(true);
      expect(result.current.unreadCount).toBe(1);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/notifications/notif-1',
          expect.objectContaining({
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ read: true }),
          })
        );
      });
    });

    it('reverts optimistic update on error', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(3);
      });

      await act(async () => {
        await result.current.markRead('notif-1');
      });

      await waitFor(() => {
        const notif = result.current.notifications.find((n) => n.id === 'notif-1');
        expect(notif?.read).toBe(false);
      });

      expect(result.current.unreadCount).toBe(2);
    });

    it('updates unread count correctly', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.unreadCount).toBe(2);
      });

      act(() => {
        result.current.markRead('notif-1');
      });

      expect(result.current.unreadCount).toBe(1);
    });
  });

  describe('markAllRead', () => {
    it('optimistically marks all notifications as read', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.unreadCount).toBe(2);
      });

      act(() => {
        result.current.markAllRead();
      });

      expect(result.current.notifications.every((n) => n.read)).toBe(true);
      expect(result.current.unreadCount).toBe(0);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/notifications/mark-all-read', {
          method: 'POST',
        });
      });
    });

    it('reverts all updates on error', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.unreadCount).toBe(2);
      });

      await act(async () => {
        await result.current.markAllRead();
      });

      await waitFor(() => {
        expect(result.current.unreadCount).toBe(2);
      });

      expect(result.current.notifications).toEqual(mockNotifications);
    });
  });

  describe('enabled: false (disabled mode)', () => {
    it('returns static empty state without fetching', () => {
      const { result } = renderHook(() => useNotifications({ enabled: false }));

      expect(result.current.notifications).toEqual([]);
      expect(result.current.unreadCount).toBe(0);
      expect(result.current.isLoading).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not create EventSource connection', () => {
      const EventSourceSpy = vi.fn();
      global.EventSource = EventSourceSpy as unknown as typeof EventSource;

      renderHook(() => useNotifications({ enabled: false }));

      expect(EventSourceSpy).not.toHaveBeenCalled();

      // @ts-expect-error — cleanup global mock
      delete global.EventSource;
    });

    it('does not start polling', async () => {
      vi.useFakeTimers();

      renderHook(() => useNotifications({ enabled: false }));

      await act(async () => {
        vi.advanceTimersByTime(120_000);
        await Promise.resolve();
      });

      expect(fetch).not.toHaveBeenCalled();
    });

    it('provides no-op functions that do not throw', async () => {
      const { result } = renderHook(() => useNotifications({ enabled: false }));

      // These should not throw or call fetch
      await act(async () => {
        await result.current.markRead('any-id');
        await result.current.markAllRead();
        await result.current.refresh();
        result.current.prepend({
          id: 'x',
          type: 'PODCAST_READY',
          title: 't',
          message: 'm',
          read: false,
          data: null,
          createdAt: '',
        });
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(result.current.notifications).toEqual([]);
    });
  });

  describe('refresh', () => {
    it('manually refetches notifications', async () => {
      const initialNotifications = [mockNotifications[0]];

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: initialNotifications, unreadCount: 1, total: 1 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
        } as Response);

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(1);
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.notifications).toHaveLength(3);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('sets loading state during refresh', async () => {
      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({ notifications: mockNotifications, unreadCount: 2, total: 3 }),
              } as Response);
            }, 100);
          })
      );

      const { result } = renderHook(() => useNotifications());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.refresh();
      });

      // Loading should be true immediately after calling refresh
      expect(result.current.isLoading).toBe(true);

      // Wait for the refresh to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });
});
