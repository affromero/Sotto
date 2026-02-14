'use client';

import { Bell } from 'lucide-react';
import styles from './NotificationBell.module.css';

interface NotificationBellProps {
  unreadCount: number;
  onClick: () => void;
}

export function NotificationBell({ unreadCount, onClick }: NotificationBellProps) {
  const displayCount = unreadCount > 9 ? '9+' : String(unreadCount);
  const hasUnread = unreadCount > 0;

  return (
    <button
      className={`${styles.button} ${hasUnread ? styles.hasUnread : ''}`}
      onClick={onClick}
      aria-label={
        hasUnread
          ? `Notifications - ${unreadCount} unread`
          : 'Notifications - no unread'
      }
    >
      <Bell size={22} className={styles.icon} />
      {hasUnread && (
        <span className={styles.badge} aria-hidden="true">
          {displayCount}
        </span>
      )}
    </button>
  );
}
