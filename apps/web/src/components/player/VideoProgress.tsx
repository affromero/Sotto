'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './VideoProgress.module.css';

interface SegmentVisual {
  id: string;
  segmentId: string;
  visualType: string;
  status: string;
  assetUrl: string | null;
}

interface VideoStatusResponse {
  videoGenerationId: string;
  status: 'PENDING' | 'CLASSIFYING' | 'GENERATING_VISUALS' | 'COMPOSING' | 'READY' | 'FAILED';
  videoUrl: string | null;
  failureReason: string | null;
  segmentVisuals: SegmentVisual[];
}

interface VideoProgressProps {
  podcastId: string;
  videoGenerationId: string;
  onComplete: (videoUrl: string) => void;
}

const STAGES = ['CLASSIFYING', 'GENERATING_VISUALS', 'COMPOSING', 'READY'] as const;

const STAGE_LABELS: Record<string, string> = {
  PENDING: 'Starting...',
  CLASSIFYING: 'Classifying segments',
  GENERATING_VISUALS: 'Generating visuals',
  COMPOSING: 'Composing video',
  READY: 'Ready',
};

function stageIndex(status: string): number {
  const idx = STAGES.indexOf(status as (typeof STAGES)[number]);
  return idx === -1 ? 0 : idx;
}

export function VideoProgress({ podcastId, videoGenerationId, onComplete }: VideoProgressProps) {
  const [data, setData] = useState<VideoStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`);
      if (!res.ok) return;
      const json = await res.json() as VideoStatusResponse;
      if (!json.status) return;
      setData(json);

      if (json.status === 'READY' && json.videoUrl && !completedRef.current) {
        completedRef.current = true;
        if (intervalRef.current) clearInterval(intervalRef.current);
        onComplete(json.videoUrl);
      }

      if (json.status === 'FAILED') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setError(json.failureReason || 'Video generation failed.');
      }
    } catch {
      // Silently retry next interval
    }
  }, [podcastId, onComplete]);

  useEffect(() => {
    // Suppress unused variable warning — videoGenerationId is used for React key identity
    void videoGenerationId;
    // Defer initial poll to avoid setState-in-effect lint rule
    const initialTimer = setTimeout(poll, 0);
    intervalRef.current = setInterval(poll, 5000);
    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll, videoGenerationId]);

  const currentStatus = data?.status || 'PENDING';
  const currentStage = stageIndex(currentStatus);
  const progressPercent = currentStatus === 'READY'
    ? 100
    : Math.round(((currentStage + 0.5) / STAGES.length) * 100);

  return (
    <div className={styles.root} role="status" aria-label="Video generation progress">
      <div className={styles.header}>
        <span className={styles.label}>{STAGE_LABELS[currentStatus] || currentStatus}</span>
        <span className={styles.percent}>{progressPercent}%</span>
      </div>

      <div className={styles.progressBar} role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
        <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
      </div>

      <div className={styles.stages}>
        {STAGES.map((stage, i) => {
          const isDone = currentStage > i || currentStatus === 'READY';
          const isActive = currentStage === i && currentStatus !== 'READY';
          return (
            <div
              key={stage}
              className={`${styles.stage} ${isDone ? styles.stageDone : ''} ${isActive ? styles.stageActive : ''}`}
            >
              <div className={styles.stageDot} />
              <span className={styles.stageLabel}>{STAGE_LABELS[stage]}</span>
            </div>
          );
        })}
      </div>

      {data?.segmentVisuals && data.segmentVisuals.length > 0 && (
        <div className={styles.visuals}>
          <span className={styles.visualsLabel}>Segment visuals</span>
          <div className={styles.visualsList}>
            {data.segmentVisuals.map((v) => (
              <div
                key={v.id}
                className={`${styles.visualChip} ${styles[`visual_${v.status}`] || ''}`}
                title={`${v.visualType} — ${v.status}`}
              />
            ))}
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
