'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { NotificationData } from '@/types/notification';

const POLL_INTERVAL_MS = 30_000;

interface UseNotificationsOptions {
  onNewNotifications?: (notifications: NotificationData[]) => void;
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

export function useNotifications(options?: UseNotificationsOptions): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialLoadRef = useRef(true);
  const onNewRef = useRef(options?.onNewNotifications);
  onNewRef.current = options?.onNewNotifications;

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

  useEffect(() => {
    fetchNotifications();

    intervalRef.current = setInterval(fetchNotifications, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useCallback(async (notificationId: string) => {
    // Optimistic update
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
      // Revert optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n))
      );
    }
  }, []);

  const markAllRead = useCallback(async () => {
    // Optimistic update
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
      // Revert optimistic update
      setNotifications(previousNotifications);
    }
  }, [notifications]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchNotifications();
  }, [fetchNotifications]);

  const prepend = useCallback((notification: NotificationData) => {
    seenIdsRef.current.add(notification.id);
    setNotifications((prev) => {
      // Deduplicate — if already in the list, don't add
      if (prev.some((n) => n.id === notification.id)) return prev;
      return [notification, ...prev];
    });
  }, []);

  return { notifications, unreadCount, isLoading, markRead, markAllRead, refresh, prepend };
}
