'use client';

import { useRouter } from 'next/navigation';
import {
  Headphones,
  Bell,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  FileText,
  Trash2,
  Gift,
  Video,
  Megaphone,
} from 'lucide-react';
import type { NotificationData } from '@/types/notification';
import { getNotificationUrl } from '@/lib/notification-utils';
import styles from './NotificationList.module.css';

interface NotificationListProps {
  notifications: NotificationData[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onNavigate?: () => void;
}

const typeIcons: Record<string, typeof Bell> = {
  // Pipeline — success
  EPISODE_READY: Headphones,
  SCRIPT_READY: FileText,
  VIDEO_READY: Video,

  // Pipeline — failure
  EPISODE_FAILED: AlertTriangle,
  VIDEO_FAILED: AlertTriangle,
  AVATAR_FAILED: AlertTriangle,
  KEY_INVALID: AlertTriangle,
  PIPELINE_FAILURE: AlertTriangle,

  QUESTION_ON_YOUR_EPISODE: HelpCircle,
  REFERRAL_SIGNUP: Gift,

  // Moderation
  CONTENT_REMOVED: Trash2,
  ACCOUNT_WARNING: AlertOctagon,

  // System
  PLATFORM_ANNOUNCEMENT: Megaphone,
};

function getRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function NotificationList({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
}: NotificationListProps) {
  const router = useRouter();
  const hasUnread = notifications.some((n) => !n.read);

  function handleClick(notification: NotificationData) {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    const url = getNotificationUrl(notification);
    if (url) {
      onNavigate?.();
      router.push(url);
    }
  }

  return (
    <div className={styles.panel} role="region" aria-label="Notifications">
      <div className={styles.header}>
        <h3 className={styles.title}>Notifications</h3>
        {hasUnread && (
          <button
            className={styles.markAllRead}
            onClick={onMarkAllRead}
            aria-label="Mark all notifications as read"
          >
            Mark all read
          </button>
        )}
      </div>
      {notifications.length === 0 ? (
        <div className={styles.empty}>
          <Bell size={32} className={styles.emptyIcon} />
          <p className={styles.emptyText}>No notifications yet</p>
        </div>
      ) : (
        <ul className={styles.list} role="list">
          {notifications.map((notification) => {
            const IconComponent = typeIcons[notification.type] || Bell;
            const url = getNotificationUrl(notification);
            return (
              <li
                key={notification.id}
                className={`${styles.item} ${!notification.read ? styles.unread : ''}`}
              >
                <button
                  className={`${styles.itemButton} ${url ? styles.clickable : ''}`}
                  onClick={() => handleClick(notification)}
                  aria-label={`${notification.read ? '' : 'Unread: '}${notification.title}`}
                >
                  <span className={styles.iconWrapper} aria-hidden="true">
                    <IconComponent size={18} />
                  </span>
                  <div className={styles.content}>
                    <span className={styles.itemTitle}>{notification.title}</span>
                    <span className={styles.message}>{notification.message}</span>
                  </div>
                  <span className={styles.time} suppressHydrationWarning>
                    {getRelativeTime(notification.createdAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
