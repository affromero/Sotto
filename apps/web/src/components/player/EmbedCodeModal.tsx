'use client';

import { useCallback, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import styles from './EmbedCodeModal.module.css';

interface EmbedCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  podcastId: string;
  slug?: string | null;
  handle?: string | null;
}

export function EmbedCodeModal({ isOpen, onClose, podcastId, slug, handle }: EmbedCodeModalProps) {
  const [copied, setCopied] = useState(false);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://sotto.fm';
  const embedPath = slug && handle ? `/@${handle}/${slug}/embed` : `/podcast/${podcastId}/embed`;

  const embedCode = `<iframe src="${appUrl}${embedPath}" width="100%" height="160" frameborder="0" allow="autoplay" loading="lazy" style="border-radius:12px;max-width:600px"></iframe>`;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [embedCode]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="medium">
      <div className={styles.content}>
        <span className={styles.label}>Embed Code</span>
        <div className={styles.codeWrap}>
          <textarea
            className={styles.textarea}
            value={embedCode}
            readOnly
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        </div>
        {copied ? (
          <span className={styles.copied}>Copied!</span>
        ) : (
          <button className={styles.copyBtn} onClick={handleCopy} type="button">
            Copy Code
          </button>
        )}
      </div>
    </Modal>
  );
}
