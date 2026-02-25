'use client';

import { useCallback, useMemo, useEffect, useRef } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { useScrollFollow } from '@/lib/hooks/useScrollFollow';
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

function findActiveIndex(segments: SegmentData[], currentTime: number): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.startTime !== null && currentTime >= seg.startTime) {
      return i;
    }
  }
  return 0;
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
  const activeRef = useRef<HTMLDivElement>(null);
  const { scrollContainerRef, isFollowing, reengage } = useScrollFollow();
  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);

  useEffect(() => {
    if (isFollowing) {
      activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIndex, isFollowing]);

  const handleClick = useCallback(
    (startTime: number | null) => {
      if (startTime !== null) {
        reengage();
        onSegmentClick?.(startTime);
      }
    },
    [reengage, onSegmentClick]
  );

  const prevSegment = activeIndex > 0 ? segments[activeIndex - 1] : null;
  const currentSegment = segments[activeIndex];
  const nextSegment = activeIndex < segments.length - 1 ? segments[activeIndex + 1] : null;

  return (
    <div ref={scrollContainerRef as React.RefObject<HTMLDivElement>} className={styles.root} aria-label="Teleprompter view">
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
            innerRef={activeRef}
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
