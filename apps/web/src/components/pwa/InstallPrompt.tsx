'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './InstallPrompt.module.css';

/** Minimal shape of the non-standard beforeinstallprompt event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'sotto-pwa-install-dismissed';

/**
 * Dismissible "Install Sotto" banner. Appears only when the browser fires
 * `beforeinstallprompt` (installable, not yet installed) and the learner hasn't
 * dismissed it before. No-op on iOS Safari (no event) and in standalone mode.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setVisible(false);
    setDeferred(null);
  }, [deferred]);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, []);

  if (!visible) return null;

  return (
    <div className={styles.root} role="dialog" aria-label="Install Sotto">
      <div className={styles.body}>
        <span className={styles.title}>Install Sotto</span>
        <span className={styles.text}>Add it to your home screen for full-screen, offline access.</span>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.dismiss} onClick={dismiss}>
          Not now
        </button>
        <button type="button" className={styles.install} onClick={install}>
          Install
        </button>
      </div>
    </div>
  );
}
