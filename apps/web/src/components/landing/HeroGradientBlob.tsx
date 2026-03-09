'use client';

import styles from './HeroGradientBlob.module.css';

export function HeroGradientBlob() {
  return (
    <div className={styles.blobs} aria-hidden="true">
      <svg className={styles.blob1} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="blob1-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(217, 119, 6, 0.35)" />
            <stop offset="100%" stopColor="rgba(217, 119, 6, 0)" />
          </radialGradient>
        </defs>
        <ellipse cx="100" cy="100" rx="90" ry="80" fill="url(#blob1-grad)" />
      </svg>
      <svg className={styles.blob2} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="blob2-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(30, 58, 95, 0.3)" />
            <stop offset="100%" stopColor="rgba(30, 58, 95, 0)" />
          </radialGradient>
        </defs>
        <ellipse cx="100" cy="100" rx="85" ry="95" fill="url(#blob2-grad)" />
      </svg>
      <svg className={styles.blob3} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="blob3-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(245, 158, 11, 0.2)" />
            <stop offset="100%" stopColor="rgba(245, 158, 11, 0)" />
          </radialGradient>
        </defs>
        <ellipse cx="100" cy="100" rx="75" ry="85" fill="url(#blob3-grad)" />
      </svg>
    </div>
  );
}
