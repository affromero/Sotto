'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { VocabularyEntryData } from '@/types/vocabulary';
import styles from './VocabularyMarker.module.css';

interface VocabularyMarkerProps {
  entry: VocabularyEntryData;
  children?: React.ReactNode;
}

const POS_LABELS: Record<string, string> = {
  noun: 'Noun',
  verb: 'Verb',
  adjective: 'Adj',
  adverb: 'Adv',
  phrase: 'Phrase',
  expression: 'Expr',
};

const TOOLTIP_WIDTH = 320;

export function VocabularyMarker({ entry, children }: VocabularyMarkerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('above');
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const markerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    if (!markerRef.current) return;
    const rect = markerRef.current.getBoundingClientRect();
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
        markerRef.current &&
        !markerRef.current.contains(e.target as Node)
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

  const posLabel = entry.partOfSpeech
    ? POS_LABELS[entry.partOfSpeech.toLowerCase()] ?? entry.partOfSpeech
    : null;

  const tooltip = open ? (
    <div
      ref={tooltipRef}
      className={`${styles.tooltip} ${styles[position]}`}
      style={{ top: coords.top, left: coords.left }}
      role="tooltip"
      onMouseEnter={cancelClose}
      onMouseLeave={() => setOpen(false)}
    >
      <div className={styles.tooltipHeader}>
        <span className={styles.tooltipWord}>{entry.word}</span>
        {posLabel && <span className={styles.posBadge}>{posLabel}</span>}
      </div>
      {entry.pronunciation && (
        <p className={styles.pronunciation}>{entry.pronunciation}</p>
      )}
      <p className={styles.translation}>{entry.translation}</p>
      {entry.exampleSentence && (
        <p className={styles.example}>{entry.exampleSentence}</p>
      )}
    </div>
  ) : null;

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => { cancelClose(); updatePosition(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={markerRef}
        type="button"
        className={styles.marker}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
        aria-expanded={open}
        aria-label={`Vocabulary: ${entry.word}`}
      >
        {children ?? entry.word}
      </button>
      {tooltip && createPortal(tooltip, document.body)}
    </span>
  );
}
