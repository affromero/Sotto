'use client';

import { Headphones, Heart, GitFork, UserPlus, Bell, AlertTriangle } from 'lucide-react';
import styles from './NotificationList.module.css';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

interface NotificationListProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

const typeIcons: Record<string, typeof Bell> = {
  PODCAST_READY: Headphones,
  PODCAST_FAILED: AlertTriangle,
  KEY_INVALID: AlertTriangle,
  PODCAST_LIKED: Heart,
  PODCAST_FORKED: GitFork,
  NEW_FOLLOWER: UserPlus,
  PIPELINE_FAILURE: AlertTriangle,
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
}: NotificationListProps) {
  const hasUnread = notifications.some((n) => !n.read);

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
            return (
              <li
                key={notification.id}
                className={`${styles.item} ${!notification.read ? styles.unread : ''}`}
              >
                <button
                  className={styles.itemButton}
                  onClick={() => onMarkRead(notification.id)}
                  aria-label={`${notification.read ? '' : 'Unread: '}${notification.title}`}
                >
                  <span className={styles.iconWrapper} aria-hidden="true">
                    <IconComponent size={18} />
                  </span>
                  <div className={styles.content}>
                    <span className={styles.itemTitle}>{notification.title}</span>
                    <span className={styles.message}>{notification.message}</span>
                  </div>
                  <span className={styles.time}>
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
