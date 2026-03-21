'use client';

import { useState, useRef, useEffect } from 'react';
import { useNotificationContext } from '@/components/providers/NotificationProvider';
import { NotificationBell } from './NotificationBell';
import { NotificationList } from './NotificationList';
import styles from './NotificationDropdown.module.css';

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotificationContext();

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={ref}>
      <NotificationBell
        unreadCount={unreadCount}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className={styles.dropdown} role="dialog" aria-label="Notifications">
          <NotificationList
            notifications={notifications}
            onMarkRead={(id) => {
              markRead(id);
            }}
            onMarkAllRead={() => {
              markAllRead();
            }}
            onNavigate={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
