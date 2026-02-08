'use client';

import { useEffect, useRef } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';
import styles from './TranscriptPanel.module.css';

interface TranscriptPanelProps {
  segments: SegmentData[];
  references?: ReferenceData[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
}

function isCurrentSegment(segment: SegmentData, currentTime: number): boolean {
  if (segment.startTime === null || segment.duration === null) return false;
  return currentTime >= segment.startTime && currentTime < segment.startTime + segment.duration;
}

export function TranscriptPanel({ segments, references = [], currentTime, onSegmentClick }: TranscriptPanelProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentTime]);

  const hasRefs = references.length > 0;

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>Transcript</h3>
      <div className={styles.segments}>
        {segments.map((segment) => {
          const active = isCurrentSegment(segment, currentTime);
          return (
            <div
              key={segment.id}
              ref={active ? activeRef : undefined}
              className={`${styles.segment} ${active ? styles.active : ''}`}
              onClick={() => segment.startTime !== null && onSegmentClick?.(segment.startTime)}
              role="button"
              tabIndex={0}
            >
              <span
                className={`${styles.speaker} ${segment.speaker === 'HOST' ? styles.host : styles.expert}`}
              >
                {segment.speaker === 'HOST' ? 'Host' : 'Expert'}
              </span>
              <p className={styles.text}>
                {hasRefs
                  ? parseTextWithCitations(segment.text, references)
                  : segment.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
