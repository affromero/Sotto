'use client';

import { useCallback, useMemo, useRef } from 'react';
import { FilmstripBlock } from './FilmstripBlock';
import type { EditableSegmentVisual } from './VideoEditorCard';
import type { PipelineTransition } from '@/types/pipeline';
import { getSpeakerIndex } from '@/lib/speaker-colors';
import styles from './FilmstripStrip.module.css';

interface VoiceInfo {
  speaker: string;
  voiceId: string;
  provider: string | null;
  voiceName: string | null;
}

interface FilmstripStripProps {
  segments: EditableSegmentVisual[];
  selectedId: string | null;
  dirtyIds: Set<string>;
  allSpeakers: string[];
  voices: VoiceInfo[];
  transitions: PipelineTransition[];
  onSelect: (segmentVisualId: string) => void;
}

export function FilmstripStrip({
  segments,
  selectedId,
  dirtyIds,
  allSpeakers,
  voices,
  transitions,
  onSelect,
}: FilmstripStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const voiceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of voices) {
      if (v.voiceName) map.set(v.speaker, v.voiceName);
    }
    return map;
  }, [voices]);

  const totalDuration = useMemo(
    () => segments.reduce((sum, s) => sum + s.duration, 0),
    [segments],
  );

  const transitionSet = useMemo(() => {
    const set = new Set<number>();
    for (const t of transitions) {
      if (t.enabled) set.add(t.fromSegmentOrder);
    }
    return set;
  }, [transitions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedId || segments.length === 0) return;

      const currentIndex = segments.findIndex(s => s.segmentVisualId === selectedId);
      let nextIndex = currentIndex;

      if (e.key === 'ArrowRight') {
        nextIndex = Math.min(currentIndex + 1, segments.length - 1);
      } else if (e.key === 'ArrowLeft') {
        nextIndex = Math.max(currentIndex - 1, 0);
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = segments.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      const nextSegment = segments[nextIndex];
      onSelect(nextSegment.segmentVisualId);

      // Scroll the selected block into view
      const strip = stripRef.current;
      if (strip) {
        const block = strip.children[nextIndex * 2] as HTMLElement | undefined; // *2 because transition dots interleave
        if (block) {
          block.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
          block.focus();
        }
      }
    },
    [selectedId, segments, onSelect],
  );

  return (
    <div
      className={styles.strip}
      ref={stripRef}
      role="tablist"
      aria-label="Storyboard timeline"
      onKeyDown={handleKeyDown}
    >
      {segments.map((seg, i) => {
        const widthPercent = totalDuration > 0
          ? (seg.duration / totalDuration) * 100
          : 100 / segments.length;
        const hasTransition = transitionSet.has(seg.order);
        const isLast = i === segments.length - 1;

        return (
          <div key={seg.segmentVisualId} className={styles.blockWrapper}>
            <FilmstripBlock
              segment={seg}
              index={i}
              speakerIndex={getSpeakerIndex(seg.speaker, allSpeakers)}
              isSelected={selectedId === seg.segmentVisualId}
              isDirty={dirtyIds.has(seg.segmentVisualId)}
              voiceName={voiceMap.get(seg.speaker) ?? null}
              widthPercent={widthPercent}
              onClick={() => onSelect(seg.segmentVisualId)}
            />
            {!isLast && (
              <span
                className={`${styles.transitionDot} ${hasTransition ? styles.transitionDotEnabled : ''}`}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
