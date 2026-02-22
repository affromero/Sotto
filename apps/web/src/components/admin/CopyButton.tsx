'use client';

import { useState } from 'react';
import styles from './CopyButton.module.css';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      className={styles.copyButton}
      onClick={handleCopy}
      aria-label="Copy error details"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
