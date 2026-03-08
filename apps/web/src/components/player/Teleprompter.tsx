'use client';

import { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { findActiveIndex } from '@/lib/segment-utils';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';
import styles from './Teleprompter.module.css';

interface TeleprompterProps {
  segments: SegmentData[];
  references: ReferenceData[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
}

function SegmentBlock({
  segment,
  speakers,
  references,
  className,
  onClick,
  innerRef,
}: {
  segment: SegmentData;
  speakers: string[];
  references: ReferenceData[];
  className: string;
  onClick?: () => void;
  innerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const idx = getSpeakerIndex(segment.speaker, speakers);
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
        {parseTextWithCitations(segment.text, references)}
      </p>
    </div>
  );
}

export function Teleprompter({
  segments,
  references,
  currentTime,
  onSegmentClick,
}: TeleprompterProps) {
  const activeIndex = useMemo(
    () => findActiveIndex(segments, currentTime),
    [segments, currentTime]
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);

  // Window-level idle detection: auto-scroll back to teleprompter after 3s idle
  const [isIdle, setIsIdle] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const resetIdle = () => {
      setIsIdle(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setIsIdle(true), 3000);
    };

    window.addEventListener('mousemove', resetIdle, { passive: true });
    window.addEventListener('wheel', resetIdle, { passive: true });
    window.addEventListener('touchstart', resetIdle, { passive: true });

    return () => {
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('wheel', resetIdle);
      window.removeEventListener('touchstart', resetIdle);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // Scroll teleprompter root into view when user becomes idle
  useEffect(() => {
    if (isIdle) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rootRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'center',
      });
    }
  }, [isIdle]);

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
    <div ref={rootRef} className={styles.root} aria-label="Teleprompter view">
      <div className={styles.viewport}>
        {prevSegment && (
          <SegmentBlock
            segment={prevSegment}
            speakers={speakers}
            references={references}
            className={`${styles.segment} ${styles.prev}`}
            onClick={() => handleClick(prevSegment.startTime)}
          />
        )}

        {currentSegment && (
          <SegmentBlock
            segment={currentSegment}
            speakers={speakers}
            references={references}
            className={`${styles.segment} ${styles.active}`}
            onClick={() => handleClick(currentSegment.startTime)}
          />
        )}

        {nextSegment && (
          <SegmentBlock
            segment={nextSegment}
            speakers={speakers}
            references={references}
            className={`${styles.segment} ${styles.next}`}
            onClick={() => handleClick(nextSegment.startTime)}
          />
        )}
      </div>
    </div>
  );
}
