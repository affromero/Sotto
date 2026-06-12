'use client';

import { useCallback, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { WordTiming } from '@sotto/shared';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { parseTextWithVocabulary, parseTextWithCitationsAndVocabulary } from '@/lib/vocabulary-parser';
import { findActiveIndex, findActiveWordIndex } from '@/lib/segment-utils';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import { STAGE_DIRECTION_PATTERN } from '@/lib/tts-text-cleaner';
import type { SegmentData } from '@/types/episode';
import type { ReferenceData } from '@/types/reference';
import type { VocabularyEntryData } from '@/types/vocabulary';
import styles from './Teleprompter.module.css';

interface TeleprompterProps {
  segments: SegmentData[];
  references: ReferenceData[];
  vocabularyEntries?: VocabularyEntryData[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
}

/** Render words with karaoke-style highlighting based on word timings */
function renderWordTimings(
  wordTimings: WordTiming[],
  timeInSegment: number,
): React.ReactNode {
  const activeIdx = findActiveWordIndex(wordTimings, timeInSegment);
  return wordTimings.map((wt, i) => {
    let cls = styles.word;
    if (i < activeIdx || (activeIdx === -1 && timeInSegment >= wt.end)) {
      cls += ` ${styles.wordSpoken}`;
    } else if (i === activeIdx) {
      cls += ` ${styles.wordCurrent}`;
    } else {
      cls += ` ${styles.wordUpcoming}`;
    }
    return (
      <span key={i} className={cls}>
        {wt.word}{' '}
      </span>
    );
  });
}

function SegmentBlock({
  segment,
  speakers,
  references,
  vocabularyEntries = [],
  isActive = false,
  currentTime = 0,
  className,
  onClick,
  innerRef,
}: {
  segment: SegmentData;
  speakers: string[];
  references: ReferenceData[];
  vocabularyEntries?: VocabularyEntryData[];
  isActive?: boolean;
  currentTime?: number;
  className: string;
  onClick?: () => void;
  innerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const idx = getSpeakerIndex(segment.speaker, speakers);
  const cleanedText = segment.text.replace(STAGE_DIRECTION_PATTERN, '').replace(/\s{2,}/g, ' ').trim();

  const useWordLevel = isActive
    && segment.wordTimings
    && segment.wordTimings.length > 0;

  let content: React.ReactNode;
  if (useWordLevel) {
    const timeInSegment = currentTime - (segment.startTime ?? 0);
    content = renderWordTimings(segment.wordTimings!, timeInSegment);
  } else {
    const hasRefs = references.length > 0;
    const hasVocab = vocabularyEntries.length > 0;
    content = hasRefs && hasVocab
      ? parseTextWithCitationsAndVocabulary(cleanedText, references, vocabularyEntries)
      : hasRefs
        ? parseTextWithCitations(cleanedText, references)
        : hasVocab
          ? parseTextWithVocabulary(cleanedText, vocabularyEntries)
          : cleanedText;
  }

  return (
    <div
      ref={innerRef}
      className={className}
      data-speaker-index={idx}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <span className={styles.speaker} data-speaker-index={idx}>
        {segment.speaker}
      </span>
      <p className={styles.text}>
        {content}
      </p>
    </div>
  );
}

export function Teleprompter({
  segments,
  references,
  vocabularyEntries = [],
  currentTime,
  onSegmentClick,
}: TeleprompterProps) {
  const [fontScale, setFontScale] = useState(0.8);
  const MIN_SCALE = 0.6;
  const MAX_SCALE = 2;
  const STEP = 0.2;

  const activeIndex = useMemo(
    () => findActiveIndex(segments, currentTime),
    [segments, currentTime]
  );
  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);

  const handleClick = useCallback(
    (startTime: number | null) => {
      if (startTime !== null) {
        onSegmentClick?.(startTime);
      }
    },
    [onSegmentClick]
  );

  const prevSegment = activeIndex > 0 ? segments[activeIndex - 1] : null;
  const currentSegment = segments[activeIndex];
  const nextSegment = activeIndex < segments.length - 1 ? segments[activeIndex + 1] : null;

  return (
    <div className={styles.root} aria-label="Teleprompter view" style={{ '--font-scale': fontScale } as React.CSSProperties}>
      <div className={styles.sizeControls}>
        <button
          className={styles.sizeBtn}
          onClick={() => setFontScale((s) => Math.max(MIN_SCALE, +(s - STEP).toFixed(1)))}
          disabled={fontScale <= MIN_SCALE}
          aria-label="Decrease text size"
          type="button"
        >
          <Minus size={16} />
        </button>
        <button
          className={styles.sizeBtn}
          onClick={() => setFontScale((s) => Math.min(MAX_SCALE, +(s + STEP).toFixed(1)))}
          disabled={fontScale >= MAX_SCALE}
          aria-label="Increase text size"
          type="button"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className={styles.viewport}>
        {prevSegment && (
          <SegmentBlock
            segment={prevSegment}
            speakers={speakers}
            references={references}
            vocabularyEntries={vocabularyEntries}
            className={`${styles.segment} ${styles.prev}`}
            onClick={() => handleClick(prevSegment.startTime)}
          />
        )}

        {currentSegment && (
          <SegmentBlock
            segment={currentSegment}
            speakers={speakers}
            references={references}
            vocabularyEntries={vocabularyEntries}
            isActive
            currentTime={currentTime}
            className={`${styles.segment} ${styles.active}`}
            onClick={() => handleClick(currentSegment.startTime)}
          />
        )}

        {nextSegment && (
          <SegmentBlock
            segment={nextSegment}
            speakers={speakers}
            references={references}
            vocabularyEntries={vocabularyEntries}
            className={`${styles.segment} ${styles.next}`}
            onClick={() => handleClick(nextSegment.startTime)}
          />
        )}
      </div>
    </div>
  );
}
