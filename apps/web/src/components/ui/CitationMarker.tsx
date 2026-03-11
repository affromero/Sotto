'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

const TOOLTIP_WIDTH = 320;

export function CitationMarker({ references }: CitationMarkerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('above');
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const label = references.map((r) => r.number).join(',');

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const above = rect.top >= 200;
    setPosition(above ? 'above' : 'below');

    const centerX = rect.left + rect.width / 2;
    const halfW = TOOLTIP_WIDTH / 2;
    const margin = 8;
    const left = Math.max(margin, Math.min(window.innerWidth - margin - TOOLTIP_WIDTH, centerX - halfW));
    const top = above ? rect.top - 8 : rect.bottom + 8;

    setCoords({ top, left });
  }, []);

  const handleToggle = useCallback(() => {
    if (!open) updatePosition();
    setOpen((prev) => !prev);
  }, [open, updatePosition]);

  const cancelClose = useCallback(() => {
    if (closeTimeout.current != null) {
      clearTimeout(closeTimeout.current);
      closeTimeout.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    closeTimeout.current = setTimeout(() => setOpen(false), 150);
  }, []);

  useEffect(() => () => { if (closeTimeout.current != null) clearTimeout(closeTimeout.current); }, []);

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

  const tooltip = open ? (
    <div
      ref={tooltipRef}
      className={`${styles.tooltip} ${styles[position]}`}
      style={{ top: coords.top, left: coords.left }}
      role="tooltip"
      onMouseEnter={cancelClose}
      onMouseLeave={() => setOpen(false)}
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
  ) : null;

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => { cancelClose(); updatePosition(); setOpen(true); }}
      onMouseLeave={scheduleClose}
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
      {tooltip && createPortal(tooltip, document.body)}
    </span>
  );
}
