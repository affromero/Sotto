'use client';

import styles from './LinkPreview.module.css';

interface LinkPreviewProps {
  url: string;
  title: string | null;
  siteName: string | null;
  wordCount: number | null;
  isLoading: boolean;
}

export function LinkPreview({ url, title, siteName, wordCount, isLoading }: LinkPreviewProps) {
  if (isLoading) {
    return (
      <div className={styles.root}>
        <div className={styles.spinner} />
        <span className={styles.loadingText}>Extracting content...</span>
      </div>
    );
  }

  const hostname = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();

  return (
    <div className={styles.root}>
      <div className={styles.info}>
        <span className={styles.siteName}>{siteName || hostname}</span>
        {title && <span className={styles.title}>{title}</span>}
        {wordCount !== null && wordCount > 0 && (
          <span className={styles.wordCount}>
            {wordCount.toLocaleString()} words
          </span>
        )}
      </div>
    </div>
  );
}
