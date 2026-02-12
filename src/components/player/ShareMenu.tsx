'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Share2, Link2, Code, Download } from 'lucide-react';
import { Toast } from '@/components/ui/Toast';
import { EmbedCodeModal } from '@/components/player/EmbedCodeModal';
import styles from './ShareMenu.module.css';

interface ShareMenuProps {
  podcastId: string;
  podcastTitle: string;
  audioUrl: string | null;
  isPublic: boolean;
}

export function ShareMenu({ podcastId, podcastTitle, audioUrl, isPublic }: ShareMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const handleCopyLink = useCallback(async () => {
    const url = `${window.location.origin}/podcast/${podcastId}`;
    await navigator.clipboard.writeText(url);
    setToastMessage('Link copied!');
    setIsOpen(false);
  }, [podcastId]);

  const handleShareTwitter = useCallback(() => {
    const url = `${window.location.origin}/podcast/${podcastId}`;
    const text = encodeURIComponent(`Check out "${podcastTitle}" on Sotto`);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}`,
      '_blank',
      'noopener,noreferrer'
    );
    setIsOpen(false);
  }, [podcastId, podcastTitle]);

  const handleEmbed = useCallback(() => {
    setIsOpen(false);
    setShowEmbed(true);
  }, []);

  const handleDownload = useCallback(() => {
    if (!audioUrl) return;
    window.open(`/api/podcasts/${podcastId}/download`, '_blank');
    setIsOpen(false);
  }, [podcastId, audioUrl]);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        className={styles.triggerBtn}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Share this podcast"
        aria-expanded={isOpen}
        type="button"
      >
        <Share2 size={18} />
        <span>Share</span>
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="menu">
          <button
            className={styles.menuItem}
            onClick={handleCopyLink}
            role="menuitem"
            type="button"
          >
            <Link2 size={16} className={styles.menuItemIcon} />
            Copy Link
          </button>
          <button
            className={styles.menuItem}
            onClick={handleShareTwitter}
            role="menuitem"
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              className={styles.menuItemIcon}
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share on X
          </button>
          {isPublic && (
            <button className={styles.menuItem} onClick={handleEmbed} role="menuitem" type="button">
              <Code size={16} className={styles.menuItemIcon} />
              Embed
            </button>
          )}
          {audioUrl && (
            <button
              className={styles.menuItem}
              onClick={handleDownload}
              role="menuitem"
              type="button"
            >
              <Download size={16} className={styles.menuItemIcon} />
              Download MP3
            </button>
          )}
        </div>
      )}

      <EmbedCodeModal
        isOpen={showEmbed}
        onClose={() => setShowEmbed(false)}
        podcastId={podcastId}
      />

      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
    </div>
  );
}
