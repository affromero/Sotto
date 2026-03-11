'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReferenceData } from '@/types/reference';
import styles from './CitationMarker.module.css';

interface CitationMarkerProps {
  references: ReferenceData[];
}

const TYPE_LABELS: Record<string, string> = {
  WEB: 'Web',
  PAPER: 'Paper',
  BOOK: 'Book',
  ARTICLE: 'Article',
  VIDEO: 'Video',
  REPORT: 'Report',
};

export function CitationMarker({ references }: CitationMarkerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('above');
  const [hOffset, setHOffset] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const label = references.map((r) => r.number).join(',');

  const TOOLTIP_WIDTH = 320; // approx mid-point of min/max width

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition(rect.top < 200 ? 'below' : 'above');

    // Clamp tooltip horizontally within viewport
    const centerX = rect.left + rect.width / 2;
    const halfW = TOOLTIP_WIDTH / 2;
    const margin = 8;
    if (centerX - halfW < margin) {
      setHOffset(margin - (centerX - halfW));
    } else if (centerX + halfW > window.innerWidth - margin) {
      setHOffset(window.innerWidth - margin - (centerX + halfW));
    } else {
      setHOffset(0);
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (!open) updatePosition();
    setOpen((prev) => !prev);
  }, [open, updatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => { updatePosition(); setOpen(true); }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={buttonRef}
        className={styles.marker}
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={`Citation ${label}`}
        type="button"
      >
        [{label}]
      </button>
      {open && (
        <div
          ref={tooltipRef}
          className={`${styles.tooltip} ${styles[position]}`}
          style={hOffset ? { transform: `translateX(calc(-50% + ${hOffset}px))` } : undefined}
          role="tooltip"
        >
          {references.map((ref) => (
            <div key={ref.id} className={styles.refItem}>
              <div className={styles.refHeader}>
                <span className={styles.refNumber}>[{ref.number}]</span>
                <span className={styles.refType}>{TYPE_LABELS[ref.type] || ref.type}</span>
              </div>
              <p className={styles.refTitle}>{ref.title}</p>
              {ref.authors.length > 0 && (
                <p className={styles.refAuthors}>{ref.authors.join(', ')}</p>
              )}
              <p className={styles.refMeta}>
                {ref.year && <span>{ref.year}</span>}
                {ref.publisher && (
                  <>
                    {ref.year && <span className={styles.refMetaDot}> &middot; </span>}
                    <span>{ref.publisher}</span>
                  </>
                )}
              </p>
              {ref.url && (
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.refLink}
                >
                  View source &rarr;
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
