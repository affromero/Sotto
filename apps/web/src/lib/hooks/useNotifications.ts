'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { NotificationData } from '@/types/notification';

/** Background poll interval when SSE is connected (consistency check) */
const SSE_POLL_INTERVAL_MS = 120_000;
/** Poll interval when SSE is not available (fallback) */
const FALLBACK_POLL_INTERVAL_MS = 60_000;

interface UseNotificationsOptions {
  onNewNotifications?: (notifications: NotificationData[]) => void;
  /** When false, skip all fetching/SSE/polling and return static empty state. Default: true */
  enabled?: boolean;
}

interface UseNotificationsReturn {
  notifications: NotificationData[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Prepend a notification from an external source (e.g. SSE) */
  prepend: (notification: NotificationData) => void;
}

const DISABLED_NOOP_MARK_READ = async () => {};
const DISABLED_NOOP_MARK_ALL = async () => {};
const DISABLED_NOOP_REFRESH = async () => {};
const DISABLED_NOOP_PREPEND = () => {};

const DISABLED_RETURN: UseNotificationsReturn = {
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  markRead: DISABLED_NOOP_MARK_READ,
  markAllRead: DISABLED_NOOP_MARK_ALL,
  refresh: DISABLED_NOOP_REFRESH,
  prepend: DISABLED_NOOP_PREPEND,
};

export function useNotifications(options?: UseNotificationsOptions): UseNotificationsReturn {
  const enabled = options?.enabled ?? true;
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialLoadRef = useRef(true);
  const onNewRef = useRef(options?.onNewNotifications);
  onNewRef.current = options?.onNewNotifications;
  const sseConnectedRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) return;
      const json = await response.json();
      const data: NotificationData[] = json.notifications ?? [];

      // Detect new notifications (skip on first load to avoid toasting old ones)
      if (!initialLoadRef.current && onNewRef.current) {
        const newNotifications = data.filter((n) => !seenIdsRef.current.has(n.id));
        if (newNotifications.length > 0) {
          onNewRef.current(newNotifications);
        }
      }
      initialLoadRef.current = false;

      // Update seen IDs
      seenIdsRef.current = new Set(data.map((n) => n.id));

      setNotifications(data);
    } catch {
      // Silently fail on poll errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  const prepend = useCallback((notification: NotificationData) => {
    seenIdsRef.current.add(notification.id);
    setNotifications((prev) => {
      if (prev.some((n) => n.id === notification.id)) return prev;
      return [notification, ...prev];
    });
  }, []);

  // SSE connection for real-time notifications
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;

      es = new EventSource('/api/notifications/stream');

      es.onopen = () => {
        sseConnectedRef.current = true;
        // Switch to slower background poll now that SSE is active
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(fetchNotifications, SSE_POLL_INTERVAL_MS);
      };

      es.onmessage = (event) => {
        try {
          const notification: NotificationData = JSON.parse(event.data);
          prepend(notification);
          // Fire toast callback for SSE-delivered notifications
          if (onNewRef.current) {
            onNewRef.current([notification]);
          }
        } catch {
          // Ignore malformed SSE data
        }
      };

      es.onerror = () => {
        sseConnectedRef.current = false;
        es?.close();
        es = null;

        // Switch back to faster poll
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(fetchNotifications, FALLBACK_POLL_INTERVAL_MS);

        // Reconnect after 5s
        if (!disposed) {
          reconnectTimeout = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      sseConnectedRef.current = false;
      es?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [enabled, fetchNotifications, prepend]);

  // Initial fetch + polling (SSE effect may adjust the interval)
  useEffect(() => {
    if (!enabled) return;
    fetchNotifications();

    intervalRef.current = setInterval(fetchNotifications, FALLBACK_POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useCallback(async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );

    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
      if (!response.ok) {
        throw new Error('Failed to mark notification as read');
      }
    } catch {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n))
      );
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const previousNotifications = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }
    } catch {
      setNotifications(previousNotifications);
    }
  }, [notifications]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchNotifications();
  }, [fetchNotifications]);

  if (!enabled) return DISABLED_RETURN;

  return { notifications, unreadCount, isLoading, markRead, markAllRead, refresh, prepend };
}
