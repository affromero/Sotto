'use client';

import { createContext, useCallback, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useAuth } from '@/lib/hooks/useAuth';
import { useToast } from '@/components/providers/ToastProvider';
import {
  isPipelineSuccessNotification,
  isErrorNotification,
  getNotificationUrl,
} from '@/lib/notification-utils';
import type { NotificationData } from '@/types/notification';

interface NotificationContextType {
  notifications: NotificationData[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
  prepend: (notification: NotificationData) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const handleNewNotifications = useCallback(
    (newNotifications: NotificationData[]) => {
      for (const notification of newNotifications) {
        if (isPipelineSuccessNotification(notification.type)) {
          const url = getNotificationUrl(notification);
          showToast(notification.title, 'success', 6000, url ? {
            label: 'View',
            onClick: () => router.push(url),
          } : undefined);
        } else if (isErrorNotification(notification.type)) {
          showToast(notification.title, 'error', 8000, {
            label: 'Report',
            onClick: () => router.push('/feedback'),
          });
        }
      }
    },
    [showToast, router]
  );

  const notificationState = useNotifications({
    onNewNotifications: handleNewNotifications,
    enabled: isAuthenticated,
  });

  return (
    <NotificationContext.Provider value={notificationState}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext(): NotificationContextType {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotificationContext must be used within NotificationProvider');
  }
  return context;
}
