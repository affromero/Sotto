'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { parseTextWithVocabulary, parseTextWithCitationsAndVocabulary } from '@/lib/vocabulary-parser';
import { useScrollFollow, isScrollable } from '@/lib/hooks/useScrollFollow';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import { AudioPlayerContext } from '@/components/providers/AudioPlayerProvider';
import { SegmentData } from '@/types/episode';
import type { ReferenceData } from '@/types/reference';
import type { VocabularyEntryData } from '@/types/vocabulary';
import styles from './TranscriptPanel.module.css';

interface TranscriptPanelProps {
  segments: SegmentData[];
  references?: ReferenceData[];
  vocabularyEntries?: VocabularyEntryData[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
}

function isCurrentSegment(segment: SegmentData, currentTime: number): boolean {
  if (segment.startTime === null || segment.duration === null) return false;
  return currentTime >= segment.startTime && currentTime < segment.startTime + segment.duration;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TranscriptPanel({
  segments,
  references = [],
  vocabularyEntries = [],
  currentTime,
  onSegmentClick,
}: TranscriptPanelProps) {
  const [fontScale, setFontScale] = useState(1);
  const MIN_SCALE = 0.6;
  const MAX_SCALE = 2;
  const STEP = 0.2;

  const activeRef = useRef<HTMLDivElement>(null);
  const { scrollContainerRef, isFollowing, reengage } = useScrollFollow();
  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);

  // Audio pause/resume when vocabulary tooltips open — null-safe outside AudioPlayerProvider
  const playerCtx = useContext(AudioPlayerContext);
  const onVocabPause = useCallback(() => {
    if (playerCtx?.isPlaying) playerCtx.pause();
  }, [playerCtx]);
  const onVocabResume = useCallback(() => {
    playerCtx?.play();
  }, [playerCtx]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (isFollowing && container && isScrollable(container)) {
      activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime, isFollowing, scrollContainerRef]);

  const hasRefs = references.length > 0;
  const hasVocab = vocabularyEntries.length > 0;

  return (
    <div className={styles.panel} style={{ '--font-scale': fontScale } as React.CSSProperties}>
      <div className={styles.headingRow}>
        <h3 className={styles.heading}>Transcript</h3>
        <div className={styles.sizeControls}>
          <button
            className={styles.sizeBtn}
            onClick={() => setFontScale((s) => Math.max(MIN_SCALE, +(s - STEP).toFixed(1)))}
            disabled={fontScale <= MIN_SCALE}
            aria-label="Decrease text size"
            type="button"
          >
            <Minus size={14} />
          </button>
          <button
            className={styles.sizeBtn}
            onClick={() => setFontScale((s) => Math.min(MAX_SCALE, +(s + STEP).toFixed(1)))}
            disabled={fontScale >= MAX_SCALE}
            aria-label="Increase text size"
            type="button"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div ref={scrollContainerRef as React.RefObject<HTMLDivElement>} className={styles.segments}>
        {segments.map((segment) => {
          const active = isCurrentSegment(segment, currentTime);
          const idx = getSpeakerIndex(segment.speaker, speakers);
          return (
            <div
              key={segment.id}
              ref={active ? activeRef : undefined}
              className={`${styles.segment} ${active ? styles.active : ''}`}
              data-speaker-index={idx}
              data-timestamp={segment.startTime !== null ? formatTimestamp(segment.startTime) : undefined}
              onClick={() => {
                if (segment.startTime !== null) {
                  reengage();
                  onSegmentClick?.(segment.startTime);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className={styles.speaker} data-speaker-index={idx}>
                {segment.speaker}
              </span>
              <div className={styles.text}>
                {hasRefs && hasVocab
                  ? parseTextWithCitationsAndVocabulary(segment.text, references, vocabularyEntries, onVocabPause, onVocabResume)
                  : hasRefs
                    ? parseTextWithCitations(segment.text, references)
                    : hasVocab
                      ? parseTextWithVocabulary(segment.text, vocabularyEntries, onVocabPause, onVocabResume)
                      : segment.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
