'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

// Everything is distributed from sotto.fm. The product runs on the user's stack,
// and these are the clients + installer that connect to YOUR server.
const DL_BASE = 'https://sotto.fm/download';

interface DesktopTarget {
  id: Exclude<Platform, 'unknown'>;
  label: string;
  hint: string;
  href: string;
}

const DESKTOP_TARGETS: DesktopTarget[] = [
  { id: 'mac', label: 'macOS', hint: 'Apple silicon & Intel · .dmg', href: `${DL_BASE}/mac` },
  { id: 'windows', label: 'Windows', hint: '10/11 · .msi installer', href: `${DL_BASE}/windows` },
  { id: 'linux', label: 'Linux', hint: '.AppImage / .deb', href: `${DL_BASE}/linux` },
];

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(ua)) return 'mac';
  if (/win/.test(ua)) return 'windows';
  if (/linux|android|x11/.test(ua)) return 'linux';
  return 'unknown';
}

export function DownloadOptions() {
  const [platform, setPlatform] = useState<Platform>('unknown');

  useEffect(() => {
    // Client-only OS detection after mount. Starting from 'unknown' keeps the
    // server and first client render identical (no hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(detectPlatform());
  }, []);

  return (
    <section className={styles.desktop} aria-labelledby="desktop-heading">
      <h2 id="desktop-heading" className={styles.sectionTitle}>
        Desktop app
      </h2>
      <p className={styles.sectionText}>
        <strong>Sotto Host</strong> runs the whole stack on your computer, no terminal. Open it, and
        it starts the database, workers, and your local or cloud AI, then hands you the app.
      </p>
      <div className={styles.cards}>
        {DESKTOP_TARGETS.map((target) => {
          const recommended = target.id === platform;
          return (
            <a
              key={target.id}
              href={target.href}
              className={`${styles.card} ${recommended ? styles.cardRecommended : ''}`}
            >
              {recommended && <span className={styles.badge}>Detected</span>}
              <span className={styles.cardLabel}>{target.label}</span>
              <span className={styles.cardHint}>{target.hint}</span>
              <span className={styles.cardCta}>Download</span>
            </a>
          );
        })}
      </div>

      <div className={styles.mobile}>
        <h3 className={styles.mobileTitle}>On your phone or tablet</h3>
        <p className={styles.sectionText}>
          Get the app from{' '}
          <a className={styles.inlineLink} href={DL_BASE}>
            sotto.fm/download
          </a>{' '}
          (or add this site to your home screen), then scan the code from{' '}
          <strong>Settings → Devices</strong> to connect, no password to type.
        </p>
      </div>
    </section>
  );
}
