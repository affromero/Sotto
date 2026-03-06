'use client';

import { useEffect, useRef, useMemo } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { findActiveIndex } from '@/lib/segment-utils';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';
import styles from './VideoView.module.css';

interface VideoViewProps {
  videoUrl: string;
  segments: SegmentData[];
  references: ReferenceData[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
  title?: string;
}

export function VideoView({
  videoUrl,
  segments,
  references,
  currentTime,
  onSegmentClick,
  title,
}: VideoViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isPlaying } = usePlayer();

  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);
  const activeIndex = findActiveIndex(segments, currentTime);
  const activeSegment = segments[activeIndex] ?? null;

  // Sync video time with audio player — only correct when drift > 0.3s
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - currentTime) > 0.3) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  // Sync play/pause with audio player
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying]);

  return (
    <div className={styles.root} aria-label="Video view">
      <div className={styles.videoContainer}>
        <video
          ref={videoRef}
          className={styles.video}
          src={videoUrl}
          muted
          playsInline
          aria-label={title ? `Video for ${title}` : 'Podcast video'}
        />
      </div>

      {activeSegment && (
        <div className={styles.subtitle}>
          <div
            className={styles.subtitleBlock}
            data-speaker-index={getSpeakerIndex(activeSegment.speaker, speakers)}
            onClick={() => {
              if (onSegmentClick && activeSegment.startTime !== null) {
                onSegmentClick(activeSegment.startTime);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && onSegmentClick && activeSegment.startTime !== null) {
                e.preventDefault();
                onSegmentClick(activeSegment.startTime);
              }
            }}
          >
            <span
              className={styles.speaker}
              data-speaker-index={getSpeakerIndex(activeSegment.speaker, speakers)}
            >
              {activeSegment.speaker}
            </span>
            <p className={styles.text}>
              {parseTextWithCitations(activeSegment.text, references)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
