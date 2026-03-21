'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import styles from './Toast.module.css';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  action?: ToastAction;
  onClose: () => void;
}

export function Toast({ message, type = 'info', duration = 4000, action, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className={`${styles.toast} ${styles[type]} ${visible ? styles.visible : styles.hidden}`}>
      <span>{message}</span>
      <div className={styles.actions}>
        {action && (
          <button
            className={styles.actionButton}
            onClick={() => {
              action.onClick();
              onClose();
            }}
          >
            {action.label}
          </button>
        )}
        <button className={styles.close} onClick={onClose} aria-label="Close notification">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
