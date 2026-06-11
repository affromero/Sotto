'use client';

import { Bell, X } from 'lucide-react';
import styles from './PushPrompt.module.css';

interface PushPromptProps {
  onEnable: () => void;
  onDismiss: () => void;
}

export function PushPrompt({ onEnable, onDismiss }: PushPromptProps) {
  return (
    <div className={styles.banner} role="alert">
      <div className={styles.content}>
        <span className={styles.icon} aria-hidden="true">
          <Bell size={20} />
        </span>
        <p className={styles.message}>
          Enable push notifications to know when your lesson is ready
        </p>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.enableButton}
          onClick={onEnable}
          aria-label="Enable push notifications"
        >
          Enable
        </button>
        <button
          className={styles.dismissButton}
          onClick={onDismiss}
          aria-label="Dismiss push notification prompt"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
