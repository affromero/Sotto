'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import styles from './Toast.module.css';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type = 'info', duration = 4000, onClose }: ToastProps) {
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
      <button className={styles.close} onClick={onClose} aria-label="Close notification">
        <X size={14} />
      </button>
    </div>
  );
}
