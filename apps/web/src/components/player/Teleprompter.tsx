'use client';

import { useMemo, useEffect, useRef } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';
import styles from './Teleprompter.module.css';

interface TeleprompterProps {
  segments: SegmentData[];
  references: ReferenceData[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
}

function findActiveIndex(segments: SegmentData[], currentTime: number): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.startTime !== null && currentTime >= seg.startTime) {
      return i;
    }
  }
  return 0;
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
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  const prevSegment = activeIndex > 0 ? segments[activeIndex - 1] : null;
  const currentSegment = segments[activeIndex];
  const nextSegment = activeIndex < segments.length - 1 ? segments[activeIndex + 1] : null;

  return (
    <div className={styles.root} aria-label="Teleprompter view">
      <div className={styles.viewport}>
        {/* Previous segment */}
        {prevSegment && (
          <div
            className={`${styles.segment} ${styles.prev}`}
            onClick={() => prevSegment.startTime !== null && onSegmentClick?.(prevSegment.startTime)}
            role="button"
            tabIndex={0}
          >
            <span
              className={`${styles.speaker} ${prevSegment.speaker === 'HOST' ? styles.speakerHost : styles.speakerExpert}`}
            >
              {prevSegment.speaker === 'HOST' ? 'Host' : 'Expert'}
            </span>
            <p className={styles.text}>
              {parseTextWithCitations(prevSegment.text, references)}
            </p>
          </div>
        )}

        {/* Active segment */}
        {currentSegment && (
          <div
            ref={activeRef}
            className={`${styles.segment} ${styles.active} ${currentSegment.speaker === 'HOST' ? styles.activeHost : styles.activeExpert}`}
            onClick={() => currentSegment.startTime !== null && onSegmentClick?.(currentSegment.startTime)}
            role="button"
            tabIndex={0}
          >
            <span
              className={`${styles.speaker} ${currentSegment.speaker === 'HOST' ? styles.speakerHost : styles.speakerExpert}`}
            >
              {currentSegment.speaker === 'HOST' ? 'Host' : 'Expert'}
            </span>
            <p className={styles.text}>
              {parseTextWithCitations(currentSegment.text, references)}
            </p>
          </div>
        )}

        {/* Next segment */}
        {nextSegment && (
          <div
            className={`${styles.segment} ${styles.next}`}
            onClick={() => nextSegment.startTime !== null && onSegmentClick?.(nextSegment.startTime)}
            role="button"
            tabIndex={0}
          >
            <span
              className={`${styles.speaker} ${nextSegment.speaker === 'HOST' ? styles.speakerHost : styles.speakerExpert}`}
            >
              {nextSegment.speaker === 'HOST' ? 'Host' : 'Expert'}
            </span>
            <p className={styles.text}>
              {parseTextWithCitations(nextSegment.text, references)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
