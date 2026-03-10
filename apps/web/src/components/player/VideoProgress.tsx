'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import {
  Image as ImageIcon, Film, BarChart3, Quote, GitCompare, Clock, Network, Type,
  AlertTriangle, RefreshCw, Pencil, Users,
} from 'lucide-react';
import styles from './VideoProgress.module.css';

interface SegmentVisual {
  id: string;
  segmentId: string;
  visualType: string;
  prompt: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  assetUrl: string | null;
  assetType: string | null;
  order: number;
  visualMode: string | null;
}

interface AvatarOverlay {
  id: string;
  speaker: string;
  avatarId: string;
  avatarName: string | null;
  previewImageUrl: string | null;
  videoUrl: string | null;
  status: string;
  durationSeconds: number | null;
}

interface VideoStatusResponse {
  videoGenerationId: string;
  status: 'PENDING' | 'CLASSIFYING' | 'GENERATING_VISUALS' | 'GENERATING_TRANSITIONS' | 'GENERATING_AVATARS' | 'COMPOSING' | 'READY' | 'FAILED';
  videoUrl: string | null;
  failureReason: string | null;
  segmentVisuals: SegmentVisual[];
  avatarOverlays?: AvatarOverlay[];
}

interface VideoProgressProps {
  podcastId: string;
  videoGenerationId: string;
  onComplete: (visuals: SegmentVisual[]) => void;
  onFailed?: (reason: string) => void;
  onRequestEdit?: (visuals: SegmentVisual[]) => void;
  onChangeAvatars?: () => void;
}

const STAGES = ['CLASSIFYING', 'GENERATING_VISUALS', 'GENERATING_TRANSITIONS', 'GENERATING_AVATARS', 'COMPOSING', 'READY'] as const;

const STAGE_LABELS: Record<string, string> = {
  PENDING: 'Starting...',
  CLASSIFYING: 'Classifying segments',
  GENERATING_VISUALS: 'Generating visuals',
  GENERATING_TRANSITIONS: 'Generating transitions',
  GENERATING_AVATARS: 'Generating avatars',
  COMPOSING: 'Composing video',
  READY: 'Ready',
  FAILED: 'Failed',
};

const VISUAL_TYPE_ICONS: Record<string, typeof ImageIcon> = {
  AI_ILLUSTRATION: ImageIcon,
  STOCK_FOOTAGE: Film,
  DATA_CHART: BarChart3,
  QUOTE: Quote,
  COMPARISON: GitCompare,
  TIMELINE: Clock,
  DIAGRAM: Network,
  TEXT_CARD: Type,
};

const VISUAL_TYPE_LABELS: Record<string, string> = {
  AI_ILLUSTRATION: 'AI Illustration',
  STOCK_FOOTAGE: 'Stock Footage',
  DATA_CHART: 'Data Chart',
  QUOTE: 'Quote',
  COMPARISON: 'Comparison',
  TIMELINE: 'Timeline',
  DIAGRAM: 'Diagram',
  TEXT_CARD: 'Text Card',
};

const PROGRAMMATIC_TYPES = new Set(['DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD']);

const SUB_MESSAGES: Record<string, string[]> = {
  PENDING: ['Preparing your video...', 'Setting up the pipeline...'],
  CLASSIFYING: [
    'Analyzing each segment for the best visual treatment...',
    'Choosing between illustrations, charts, and text cards...',
    'AI is reviewing your script structure...',
  ],
  GENERATING_VISUALS: [
    'Creating AI illustrations for your podcast...',
    'Each segment gets its own unique visual...',
    'Generating images to match your content...',
    'This is the most visual-intensive step...',
  ],
  GENERATING_TRANSITIONS: [
    'Creating AI video transitions between scenes...',
    'Blending segment boundaries with cinematic effects...',
    'Generating smooth visual bridges...',
  ],
  GENERATING_AVATARS: [
    'Generating lip-synced avatar overlays...',
    'HeyGen is rendering your avatar videos...',
    'Creating transparent avatar clips for each speaker...',
    'This step takes a few minutes per speaker...',
  ],
  COMPOSING: [
    'Rendering your final video with Remotion...',
    'Combining audio, visuals, and animations...',
    'Almost there — final composition in progress...',
    'Encoding video frames...',
  ],
};

function stageIndex(status: string): number {
  const idx = STAGES.indexOf(status as (typeof STAGES)[number]);
  return idx === -1 ? 0 : idx;
}

function FilmstripThumbnail({ visual }: { visual: SegmentVisual }) {
  const Icon = VISUAL_TYPE_ICONS[visual.visualType] || Type;
  const label = VISUAL_TYPE_LABELS[visual.visualType] || visual.visualType;
  const isProgrammatic = PROGRAMMATIC_TYPES.has(visual.visualType);
  const isReady = visual.status === 'ready';
  const isGenerating = visual.status === 'generating';
  const isFailed = visual.status === 'failed';
  const showImage = isReady && visual.assetUrl && !isProgrammatic;

  const statusClass = isFailed ? styles.thumbFailed
    : isGenerating ? styles.thumbGenerating
    : isReady ? styles.thumbReady
    : styles.thumbPending;

  return (
    <div
      className={`${styles.thumb} ${statusClass}`}
      title={`#${visual.order} ${label} — ${visual.status}`}
      data-status={visual.status}
    >
      {showImage ? (
        <NextImage
          src={visual.assetUrl!}
          alt={`Segment ${visual.order} visual`}
          className={styles.thumbImage}
          fill
          sizes="120px"
        />
      ) : (
        <div className={styles.thumbPlaceholder}>
          <Icon size={20} strokeWidth={1.5} />
          <span className={styles.thumbLabel}>{label}</span>
        </div>
      )}
      <span className={styles.thumbOrder}>{visual.order}</span>
    </div>
  );
}

export function VideoProgress({ podcastId, videoGenerationId, onComplete, onFailed, onRequestEdit, onChangeAvatars }: VideoProgressProps) {
  const [data, setData] = useState<VideoStatusResponse | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [subMessageTick, setSubMessageTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<() => void>(() => {});

  const schedulePoll = useCallback((ms: number) => {
    timerRef.current = setTimeout(() => pollRef.current(), ms);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`);
      if (!res.ok) { schedulePoll(5000); return; }
      const json = await res.json() as VideoStatusResponse;
      if (!json.status) { schedulePoll(5000); return; }
      setData(json);

      if (json.status === 'READY' && json.segmentVisuals?.length > 0 && !completedRef.current) {
        completedRef.current = true;
        onComplete(json.segmentVisuals);
        return;
      }

      if (json.status === 'FAILED') {
        onFailed?.(json.failureReason || 'Video generation failed.');
        return;
      }

      // Adaptive polling interval
      const interval = json.status === 'GENERATING_VISUALS' || json.status === 'GENERATING_TRANSITIONS' ? 3000 : 5000;
      schedulePoll(interval);
    } catch {
      schedulePoll(5000);
    }
  }, [podcastId, onComplete, onFailed, schedulePoll]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    void videoGenerationId;
    completedRef.current = false;
    schedulePoll(0);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll, videoGenerationId, schedulePoll]);

  // Sub-message rotation
  useEffect(() => {
    const interval = setInterval(() => {
      setSubMessageTick(t => t + 1);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll filmstrip to first generating segment
  useEffect(() => {
    if (!filmstripRef.current || !data?.segmentVisuals) return;
    const generating = filmstripRef.current.querySelector('[data-status="generating"]');
    if (generating) {
      generating.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    }
  }, [data?.segmentVisuals]);

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Retry failed' })) as { error?: string };
        setRetryError(body.error || 'Retry failed');
        setRetrying(false);
        return;
      }
      completedRef.current = false;
      schedulePoll(1000);
    } catch {
      setRetryError('Network error — could not retry.');
    }
    setRetrying(false);
  };

  const currentStatus = data?.status || 'PENDING';
  const currentStage = stageIndex(currentStatus);
  const visuals = data?.segmentVisuals || [];
  const readyCount = visuals.filter(v => v.status === 'ready').length;
  const failedCount = visuals.filter(v => v.status === 'failed').length;
  const totalCount = visuals.length;
  const showFilmstrip = totalCount > 0 && currentStatus !== 'PENDING';

  // Granular progress
  let progressPercent: number;
  if (currentStatus === 'READY') {
    progressPercent = 100;
  } else if (currentStatus === 'CLASSIFYING' || currentStatus === 'PENDING') {
    progressPercent = 5;
  } else if (currentStatus === 'GENERATING_VISUALS' && totalCount > 0) {
    progressPercent = 10 + Math.round((readyCount / totalCount) * 60);
  } else if (currentStatus === 'GENERATING_TRANSITIONS') {
    progressPercent = 72;
  } else if (currentStatus === 'GENERATING_AVATARS') {
    progressPercent = 78;
  } else if (currentStatus === 'COMPOSING') {
    progressPercent = 85;
  } else {
    progressPercent = Math.round(((currentStage + 0.5) / STAGES.length) * 100);
  }

  // Avatar overlay state
  const avatarOverlays = data?.avatarOverlays || [];
  const hasAvatars = avatarOverlays.length > 0;
  const avatarsFailed = avatarOverlays.some((a) => a.status === 'failed');
  const avatarsProcessing = avatarOverlays.some((a) => a.status === 'processing' || a.status === 'concatenating' || a.status === 'submitting');
  const avatarsReady = hasAvatars && avatarOverlays.every((a) => a.status === 'ready');

  const isComposing = currentStatus === 'COMPOSING';
  const isFailed = currentStatus === 'FAILED';
  const errorMessage = retryError || (isFailed ? (data?.failureReason || 'Video generation failed.') : null);

  // Sub-message
  const messages = SUB_MESSAGES[currentStatus] || SUB_MESSAGES.PENDING;
  const subMessage = messages[subMessageTick % messages.length];

  return (
    <div className={styles.root} role="status" aria-label="Video generation progress">
      <div className={styles.header}>
        <span className={styles.label}>
          {isFailed ? 'Generation failed' : (STAGE_LABELS[currentStatus] || currentStatus)}
        </span>
        {!isFailed && <span className={styles.percent}>{progressPercent}%</span>}
      </div>

      <div
        className={`${styles.progressBar} ${isComposing ? styles.progressBarIndeterminate : ''}`}
        role="progressbar"
        aria-valuenow={isComposing ? undefined : progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {isComposing ? (
          <div className={styles.progressFillIndeterminate} />
        ) : (
          <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
        )}
      </div>

      {currentStatus === 'GENERATING_VISUALS' && totalCount > 0 && (
        <p className={styles.counter}>
          {readyCount} of {totalCount} visuals generated
          {failedCount > 0 && <span className={styles.counterFailed}> ({failedCount} failed)</span>}
        </p>
      )}

      {!isFailed && (
        <p className={styles.subMessage} key={subMessageTick}>
          {subMessage}
        </p>
      )}

      <div className={styles.stages}>
        {STAGES.map((stage, i) => {
          const isDone = currentStage > i || currentStatus === 'READY';
          const isActive = currentStage === i && currentStatus !== 'READY' && !isFailed;
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

      {showFilmstrip && (
        <div className={styles.filmstrip}>
          <span className={styles.filmstripLabel}>Segment visuals</span>
          <div className={styles.filmstripTrack} ref={filmstripRef}>
            {visuals.map((v) => (
              <FilmstripThumbnail key={v.id} visual={v} />
            ))}
          </div>
        </div>
      )}

      {hasAvatars && (
        <div className={styles.avatarSection}>
          <span className={styles.filmstripLabel}>Avatars</span>
          <div className={styles.avatarList}>
            {avatarOverlays.map((overlay) => {
              const statusClass = overlay.status === 'ready' ? styles.avatarReady
                : overlay.status === 'failed' ? styles.avatarFailed
                : (overlay.status === 'processing' || overlay.status === 'concatenating' || overlay.status === 'submitting') ? styles.avatarProcessing
                : styles.avatarPending;
              return (
                <div key={overlay.id} className={`${styles.avatarItem} ${statusClass}`}>
                  {overlay.previewImageUrl ? (
                    <img src={overlay.previewImageUrl} alt={overlay.avatarName || overlay.speaker} className={styles.avatarThumb} width={32} height={32} />
                  ) : (
                    <div className={styles.avatarThumbPlaceholder}><Users size={14} /></div>
                  )}
                  <div className={styles.avatarInfo}>
                    <span className={styles.avatarSpeaker}>{overlay.speaker}</span>
                    <span className={styles.avatarStatus}>
                      {overlay.status === 'ready' ? 'Ready' : overlay.status === 'failed' ? 'Failed' : overlay.status === 'pending' ? 'Pending' : 'Processing...'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {avatarsFailed && onChangeAvatars && (
            <button className={styles.editButton} onClick={onChangeAvatars} type="button">
              <Users size={14} />
              Change Avatars
            </button>
          )}
          {avatarsReady && onChangeAvatars && (
            <button className={styles.editButton} onClick={onChangeAvatars} type="button">
              <Users size={14} />
              Change Avatars
            </button>
          )}
          {avatarsProcessing && (
            <p className={styles.counter}>Generating avatar overlays...</p>
          )}
        </div>
      )}

      {(isFailed || retryError) && errorMessage && (
        <div className={styles.errorBlock}>
          <div className={styles.errorMessage}>
            <AlertTriangle size={16} />
            <p>{errorMessage}</p>
          </div>
          <div className={styles.errorActions}>
            {onRequestEdit && visuals.length > 0 && (
              <button
                className={styles.editButton}
                onClick={() => onRequestEdit(visuals)}
                type="button"
              >
                <Pencil size={14} />
                Edit Storyboard
              </button>
            )}
            <button
              className={styles.retryButton}
              onClick={handleRetry}
              disabled={retrying}
            >
              <RefreshCw size={14} className={retrying ? styles.retrySpinning : ''} />
              {retrying ? 'Resuming...' : 'Retry'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
