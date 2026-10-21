'use client';

import { useEffect, useState } from 'react';
import type { PlayDistribution } from '@/lib/play/install/distribution';
import styles from './PlayInstallOptions.module.css';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PlayInstallOptions({
  distribution,
  error: configurationError,
  allowWeb = true,
  invitationReturn = true,
}: {
  distribution: PlayDistribution;
  error: string | null;
  allowWeb?: boolean;
  invitationReturn?: boolean;
}) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    if (!allowWeb) return;
    let stopped = false;
    const timer = setTimeout(() => {
      setInstalled(window.matchMedia('(display-mode: standalone)').matches);
      setIos(
        /iphone|ipad|ipod/i.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );
    }, 0);
    if ('serviceWorker' in navigator && window.isSecureContext)
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        if (!stopped)
          setError(
            'Home-screen installation could not be prepared. Check your connection and try again.'
          );
      });
    const offered = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', offered);
    window.addEventListener('appinstalled', complete);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', offered);
      window.removeEventListener('appinstalled', complete);
    };
  }, [allowWeb]);

  const install = async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
    } catch {
      setError('Installation did not finish. You can reopen this invitation and try again.');
    }
  };
  return (
    <section className={styles.root} aria-labelledby="play-install-heading">
      <h2 id="play-install-heading">Keep Sotto close</h2>
      <p>
        {invitationReturn
          ? 'After installing, return to this invitation and open the game.'
          : 'Install a client, then connect it to your Sotto server.'}
      </p>
      <div className={styles.native}>
        <div>
          <h3>iPhone & iPad</h3>
          {distribution.ios ? (
            <a href={distribution.ios} rel="noreferrer">
              Install from the App Store
            </a>
          ) : (
            <p>An App Store download is not configured on this server.</p>
          )}
        </div>
        <div>
          <h3>Android</h3>
          {distribution.androidStore ? (
            <a href={distribution.androidStore} rel="noreferrer">
              Install from Google Play
            </a>
          ) : distribution.androidApk ? (
            <a href={distribution.androidApk} rel="noreferrer">
              Download the Android app
            </a>
          ) : (
            <p>An Android download is not configured on this server.</p>
          )}
        </div>
      </div>
      {allowWeb ? (
        <div className={styles.web}>
          <h3>Home-screen web app</h3>
          {installed ? (
            <p role="status">You’re using the installed web app.</p>
          ) : prompt ? (
            <button
              type="button"
              onClick={() => {
                void install();
              }}
            >
              Install web app
            </button>
          ) : (
            <p>
              {ios
                ? 'In Safari, open Share, then Add to Home Screen.'
                : 'Open your browser menu and choose Install app or Add to Home Screen, if offered.'}
            </p>
          )}
          <p className={styles.note}>
            The web game also works in this browser. Playing together needs a connection.
          </p>
        </div>
      ) : (
        <p>Continue to your partner’s server before installing its home-screen web app.</p>
      )}
      {(configurationError || error) && <p role="alert">{configurationError ?? error}</p>}
    </section>
  );
}
