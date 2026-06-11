'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePodcastStatus } from '@/lib/hooks/usePodcastStatus';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Play,
  FileText,
  Download,
  Pencil,
  RefreshCw,
  Trash2,
  Shield,
  Video,
  Users,
  X,
  MessageCircleQuestion,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { OwnerOnlyBadge } from '@/components/ui/OwnerOnlyBadge';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { AudioPlayer } from '@/components/player/AudioPlayer';
import { TranscriptPanel } from '@/components/player/TranscriptPanel';
import { Teleprompter } from '@/components/player/Teleprompter';
import { ReferenceList } from '@/components/player/ReferenceList';
import { VocabularyList } from '@/components/player/VocabularyList';
import { InterruptChatPanel } from '@/components/player/InterruptChatPanel';
import { Modal } from '@/components/ui/Modal';
import { OverflowMenu } from '@/components/ui/OverflowMenu';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { VersionHistory } from '@/components/player/VersionHistory';
import { Badge } from '@/components/ui/Badge';
import { SottoBadge } from '@/components/ui/SottoBadge';
import { MetadataBadges } from '@/components/ui/MetadataBadges';
import { Button } from '@/components/ui/Button';
import { GenerationProgress } from '@/components/create/GenerationProgress';
import { ScriptEditor } from '@/components/create/ScriptEditor';
import { InsufficientRefsBanner } from '@/components/create/InsufficientRefsBanner';
import { AudioConfigPanel, type AudioConfig } from '@/components/player/AudioConfigPanel';
import { MiniPlayer } from '@/components/player/MiniPlayer';
import { VideoModelPicker } from '@/components/player/VideoModelPicker';
import { VideoProgress } from '@/components/player/VideoProgress';
import { VideoView } from '@/components/player/VideoView';
import { PipelineEditor } from '@/components/player/PipelineEditor';
import { VideoEditor } from '@/components/player/VideoEditor';
import { AvatarPicker } from '@/components/player/AvatarPicker';
import type { AvatarOverlayData } from '@/types/avatar';
import type { AvatarMaskShape } from '@/components/player/AvatarOverlay';
import type { PodcastDetail } from '@/types/podcast';
import type { VideoPipeline, FalModelsResponse } from '@/types/pipeline';
import type { PodcastStatus } from '@prisma/client';
import type { SegmentVisualData } from '@/lib/segment-utils';
import styles from './page.module.css';

export interface VideoGenerationStatus {
  available: boolean;
  hasByokKey: boolean;
}

interface PodcastPlayerViewProps {
  podcast: PodcastDetail;
  isOwner: boolean;
  isAdmin?: boolean;
  isAuthenticated: boolean;
  videoStatus?: VideoGenerationStatus;
  avatarStatus?: VideoGenerationStatus;
}

type ViewMode = 'transcript' | 'teleprompter' | 'video';

const statusVariants: Record<PodcastStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> =
  {
    PENDING: 'default',
    DISCOVERING: 'info',
    EXTRACTING: 'info',
    RESEARCHING: 'info',
    PLANNING: 'info',
    SCRIPTING: 'info',
    COMPILING: 'info',
    SCRIPT_READY: 'info',
    GENERATING_AUDIO: 'info',
    STITCHING: 'info',
    READY: 'success',
    UPDATING: 'warning',
    FAILED: 'error',
    IMPORTING: 'info',
    TRANSCRIBING: 'info',
    DUPLICATE_REVIEW: 'warning',
  };

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  return `${mins} min`;
}

function PlayerBridge({
  onTimeUpdate,
  seekRef,
  onComplete,
}: {
  onTimeUpdate: (time: number) => void;
  seekRef: React.MutableRefObject<((time: number) => void) | null>;
  onComplete?: () => void;
}) {
  const { currentTime, seek, duration } = usePlayer();
  const completeFiredRef = useRef(false);
  useEffect(() => {
    seekRef.current = seek;
  }, [seek, seekRef]);
  useEffect(() => {
    onTimeUpdate(currentTime);
  }, [currentTime, onTimeUpdate]);
  useEffect(() => {
    if (duration > 0 && currentTime / duration >= 0.95 && !completeFiredRef.current) {
      completeFiredRef.current = true;
      onComplete?.();
    }
  }, [currentTime, duration, onComplete]);
  return null;
}

export function PodcastPlayerView({
  podcast,
  isOwner,
  isAdmin,
  isAuthenticated,
  videoStatus,
  avatarStatus,
}: PodcastPlayerViewProps) {
  const router = useRouter();
  const [currentTime, setCurrentTime] = useState(0);
  const seekRef = useRef<((time: number) => void) | null>(null);
  const [showInterruptChat, setShowInterruptChat] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('transcript');
  const [pdfUrl, setPdfUrl] = useState<string | null>(podcast.pdfUrl);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState(podcast.status);
  const [liveFailureReason, setLiveFailureReason] = useState(podcast.failureReason);
  const [liveFailedAtStatus, setLiveFailedAtStatus] = useState(podcast.failedAtStatus);
  const [liveErrorId, setLiveErrorId] = useState(podcast.errorId);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [scriptTurns, setScriptTurns] = useState<Array<{ speaker: string; text: string }> | null>(
    null
  );
  const [lowReferences, setLowReferences] = useState(false);
  const [requiredRefCount, setRequiredRefCount] = useState(0);
  const [verificationProgress, setVerificationProgress] = useState<Record<string, unknown> | null>(
    ('verificationProgress' in podcast
      ? (podcast as { verificationProgress?: Record<string, unknown> | null }).verificationProgress
      : null) ?? null
  );
  const [audioConfig, setAudioConfig] = useState<AudioConfig>({ voices: [] });
  const playerSectionRef = useRef<HTMLElement>(null);
  const [videoState, setVideoState] = useState<'idle' | 'generating' | 'ready' | 'failed'>(
    podcast.videoUrl ? 'ready' : 'idle'
  );
  const [segmentVisuals, setSegmentVisuals] = useState<SegmentVisualData[]>([]);
  const [videoGenerationId, setVideoGenerationId] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<{
    message: string;
    isLlmError?: boolean;
    currentProvider?: string;
  } | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [pipelineData, setPipelineData] = useState<VideoPipeline | null>(null);
  const [showPipelineEditor, setShowPipelineEditor] = useState(false);
  const [falModels, setFalModels] = useState<FalModelsResponse | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [classificationId, setClassificationId] = useState<string | null>(null);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showVideoEditor, setShowVideoEditor] = useState(false);
  const [avatarOverlays, setAvatarOverlays] = useState<AvatarOverlayData[]>([]);
  const [avatarsVisible, setAvatarsVisible] = useState(true);
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [avatarDone, setAvatarDone] = useState(false);

  const filteredAvatarOverlays = useMemo(() => avatarOverlays, [avatarOverlays]);

  // Fetch script turns for review when SCRIPT_READY or FAILED (for AudioConfigPanel speakers)
  const needsScript =
    liveStatus === 'SCRIPT_READY' ||
    (liveStatus === 'FAILED' &&
      ['GENERATING_AUDIO', 'STITCHING'].includes(liveFailedAtStatus ?? ''));
  useEffect(() => {
    if (!needsScript || !isOwner) return;
    fetch(`/api/v1/podcasts/${podcast.id}/script`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.turns) setScriptTurns(data.turns);
        if (data?.lowReferences) {
          setLowReferences(true);
          setRequiredRefCount(data.requiredRefCount ?? 5);
          if (data.verificationProgress) {
            setVerificationProgress(data.verificationProgress as Record<string, unknown>);
          }
        }
      })
      .catch(() => {});
  }, [needsScript, isOwner, podcast.id]);

  // SSE-based status watching while podcast is processing
  const isStillProcessing =
    liveStatus !== 'READY' && liveStatus !== 'FAILED' && liveStatus !== 'SCRIPT_READY';
  usePodcastStatus({
    podcastId: isStillProcessing ? podcast.id : null,
    initialStatus: liveStatus,
    onStatusChange: useCallback(
      (event: { status: string; [key: string]: unknown }) => {
        setLiveStatus(event.status as typeof podcast.status);
        if (event.verificationProgress) {
          setVerificationProgress(event.verificationProgress as Record<string, unknown>);
        }
        if (event.failureReason) {
          setLiveFailureReason(event.failureReason as string);
        }
        if (event.failedAtStatus) {
          setLiveFailedAtStatus(event.failedAtStatus as string);
        }
        if (event.errorId) {
          setLiveErrorId(event.errorId as string);
        }
        if (event.status === 'READY') {
          router.refresh();
        }
      },
      // `podcast` appears only in a `typeof` type cast above (no runtime use), so it is not a real dependency.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [router]
    ),
  });

  // Check existing video generation status on mount
  useEffect(() => {
    if (liveStatus !== 'READY') return;
    setVideoState('idle');
    setSegmentVisuals([]);
    setVideoGenerationId(null);
    setVideoError(null);
    fetch(`/api/v1/podcasts/${podcast.id}/video`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.status) return;
        if (
          (data.status === 'READY' ||
            data.status === 'GENERATING_AVATARS' ||
            data.status === 'STALE') &&
          data.segmentVisuals?.length > 0
        ) {
          setVideoState('ready');
          setSegmentVisuals(data.segmentVisuals);
          if (data.avatarOverlays) {
            setAvatarOverlays(data.avatarOverlays);
            if (isOwner) {
              const hasInProgress = data.avatarOverlays.some((o: AvatarOverlayData) =>
                ['pending', 'concatenating', 'submitting', 'processing'].includes(o.status)
              );
              if (hasInProgress) setAvatarGenerating(true);
            }
          }
          if (typeof data.avatarsVisible === 'boolean') setAvatarsVisible(data.avatarsVisible);
        } else if (isOwner && data.status === 'FAILED') {
          setVideoState('failed');
          setVideoError({ message: data.failureReason || 'Video generation failed.' });
          if (data.segmentVisuals?.length > 0) {
            setSegmentVisuals(data.segmentVisuals);
          }
        } else if (isOwner) {
          setVideoState('generating');
          setVideoGenerationId(data.videoGenerationId);
        }
      })
      .catch(() => {});
  }, [isOwner, liveStatus, podcast.id]);

  // Poll avatar overlay status while avatars are generating (independent of video state)
  useEffect(() => {
    if (!avatarGenerating) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/podcasts/${podcast.id}/video`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.avatarOverlays) {
          setAvatarOverlays(data.avatarOverlays);
          const allDone = data.avatarOverlays.every(
            (o: AvatarOverlayData) => o.status === 'ready' || o.status === 'failed'
          );
          if (allDone) {
            setAvatarGenerating(false);
            const anyReady = data.avatarOverlays.some(
              (o: AvatarOverlayData) => o.status === 'ready'
            );
            if (anyReady) {
              setAvatarDone(true);
              setTimeout(() => setAvatarDone(false), 3000);
            }
          }
        }
      } catch {
        /* ignore */
      }
    };
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [avatarGenerating, podcast.id]);

  // Auto-select video tab when visuals become available; fall back to transcript when removed
  useEffect(() => {
    if (segmentVisuals.length > 0 && viewMode !== 'video') {
      setViewMode('video');
    } else if (segmentVisuals.length === 0 && viewMode === 'video') {
      setViewMode('transcript');
    }
  }, [segmentVisuals.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerateVideo = useCallback(
    async (override?: { aiModel: string }, forceReclassify?: boolean) => {
      // If we already have pipeline data in memory, just reopen the editor
      if (pipelineData && !override && !forceReclassify) {
        if (!falModels) {
          const res = await fetch('/api/v1/fal-models');
          if (res.ok) setFalModels(await res.json());
        }
        setShowPipelineEditor(true);
        return;
      }

      setPipelineLoading(true);
      setVideoError(null);
      try {
        // Check for a saved draft before triggering classification
        if (!override && !forceReclassify) {
          const [draftRes, modelsRes] = await Promise.all([
            fetch(`/api/v1/podcasts/${podcast.id}/video/pipeline`),
            !falModels ? fetch('/api/v1/fal-models') : Promise.resolve(null),
          ]);
          if (modelsRes?.ok) setFalModels(await modelsRes.json());
          if (draftRes.ok) {
            const draft = await draftRes.json();
            if (draft.status === 'saved' && draft.pipeline) {
              setPipelineData(draft.pipeline);
              setShowPipelineEditor(true);
              setPipelineLoading(false);
              return;
            }
          }
        }

        // No saved draft — trigger classification
        const pipelineBody = { ...override };
        const hasBody = Object.keys(pipelineBody).length > 0;
        const pipelineOpts: RequestInit = hasBody
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(pipelineBody),
            }
          : { method: 'POST' };
        const [pipelineRes, modelsRes] = await Promise.all([
          fetch(`/api/v1/podcasts/${podcast.id}/video/pipeline`, pipelineOpts),
          !falModels ? fetch('/api/v1/fal-models') : Promise.resolve(null),
        ]);
        if (modelsRes?.ok) setFalModels(await modelsRes.json());
        if (!pipelineRes.ok) {
          const err = await pipelineRes.json().catch(() => ({}));
          setVideoError({
            message: err.error || 'Failed to create pipeline.',
            isLlmError: err.isLlmError,
            currentProvider: err.currentProvider,
          });
          setPipelineLoading(false);
          return;
        }
        const data = await pipelineRes.json();
        // POST now returns { classificationId, status: 'classifying' } — start polling
        setClassificationId(data.classificationId);
      } catch {
        setVideoError({ message: 'Failed to create pipeline.' });
        setPipelineLoading(false);
      }
    },
    [podcast.id, pipelineData, falModels]
  );

  // Poll for pipeline classification result
  useEffect(() => {
    if (!classificationId || !pipelineLoading) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/v1/podcasts/${podcast.id}/video/pipeline?classificationId=${classificationId}`
        );
        if (cancelled) return;
        if (!res.ok) {
          if (!cancelled) setTimeout(poll, 5000);
          return;
        }
        const data = await res.json();
        if (data.status === 'ready') {
          setPipelineData(data.pipeline);
          setShowPipelineEditor(true);
          setPipelineLoading(false);
          setClassificationId(null);
          return;
        }
        if (data.status === 'failed') {
          setVideoError({
            message: data.error || 'Classification failed.',
            isLlmError: data.isLlmError,
            currentProvider: data.currentProvider,
          });
          setPipelineLoading(false);
          setClassificationId(null);
          return;
        }
        // Still classifying — poll again
        if (!cancelled) setTimeout(poll, 3000);
      } catch {
        if (!cancelled) setTimeout(poll, 5000);
      }
    };
    const timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [classificationId, pipelineLoading, podcast.id]);

  const handlePipelineApprove = useCallback(
    async (pipeline: VideoPipeline) => {
      setShowPipelineEditor(false);
      setVideoState('generating');
      setVideoLoading(true);
      try {
        const res = await fetch(`/api/v1/podcasts/${podcast.id}/video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pipeline }),
        });
        if (!res.ok) throw new Error('Failed to start video generation');
        const data = await res.json();
        setVideoGenerationId(data.videoGenerationId);
      } catch (err) {
        setVideoState('failed');
        setVideoError({ message: err instanceof Error ? err.message : 'Generation failed' });
      } finally {
        setVideoLoading(false);
      }
    },
    [podcast.id]
  );

  const dismissVideoError = useCallback(() => {
    setVideoState('idle');
    setVideoError(null);
  }, []);

  const avatarPositionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAvatarPositionChange = useCallback(
    (speaker: string, pos: { posX: number; posY: number; width: number; height: number }) => {
      // Update local state immediately
      setAvatarOverlays((prev) => prev.map((o) => (o.speaker === speaker ? { ...o, ...pos } : o)));
      // Debounce API call
      if (avatarPositionTimerRef.current) clearTimeout(avatarPositionTimerRef.current);
      avatarPositionTimerRef.current = setTimeout(() => {
        fetch(`/api/v1/podcasts/${podcast.id}/video/avatars/positions`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positions: [{ speaker, ...pos }] }),
        }).catch(() => {});
      }, 500);
    },
    [podcast.id]
  );

  const handleMaskShapeChange = useCallback(
    (speaker: string, shape: AvatarMaskShape) => {
      setAvatarOverlays((prev) =>
        prev.map((o) => (o.speaker === speaker ? { ...o, maskShape: shape } : o))
      );
      fetch(`/api/v1/podcasts/${podcast.id}/video/avatars/positions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions: [{ speaker, maskShape: shape }] }),
      }).catch(() => {});
    },
    [podcast.id]
  );

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const body: Record<string, unknown> = {};
      // Extract provider from first voice with an explicit provider (for retry)
      const firstVoiceProvider = audioConfig.voices.find((v) => v.provider)?.provider;
      if (firstVoiceProvider) {
        const [provider, ...modelParts] = firstVoiceProvider.split(':');
        body.ttsProvider = provider;
        if (modelParts.length) body.ttsModel = modelParts.join(':');
      }
      const response = await fetch(`/api/v1/podcasts/${podcast.id}/generate`, {
        method: 'POST',
        ...(Object.keys(body).length > 0
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      if (response.ok) {
        window.location.reload();
      }
    } catch {
      setRetrying(false);
    }
  }, [podcast.id, audioConfig]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/v1/podcasts/${podcast.id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        router.push('/dashboard');
      }
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [podcast.id, router]);

  const handleExportPdf = useCallback(async () => {
    if (!isAuthenticated) return;

    // If PDF already available, open it
    if (pdfUrl) {
      window.open(pdfUrl, '_blank');
      return;
    }

    setPdfLoading(true);
    try {
      const response = await fetch(`/api/v1/podcasts/${podcast.id}/export`, {
        method: 'POST',
      });
      const data = await response.json();

      if (data.status === 'ready' && data.pdfUrl) {
        setPdfUrl(data.pdfUrl);
        setPdfLoading(false);
        window.open(data.pdfUrl, '_blank');
        return;
      }

      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const pollResponse = await fetch(`/api/v1/podcasts/${podcast.id}/export`);
          const pollData = await pollResponse.json();
          if (pollData.status === 'ready' && pollData.pdfUrl) {
            clearInterval(pollInterval);
            setPdfUrl(pollData.pdfUrl);
            setPdfLoading(false);
          }
        } catch {
          clearInterval(pollInterval);
          setPdfLoading(false);
        }
      }, 3000);

      // Safety timeout: stop polling after 60s
      setTimeout(() => {
        clearInterval(pollInterval);
        setPdfLoading(false);
      }, 60000);
    } catch {
      setPdfLoading(false);
    }
  }, [isAuthenticated, podcast.id, pdfUrl]);

  const handleInterrupt = useCallback(() => {
    setShowInterruptChat(true);
  }, []);

  const handleSegmentClick = useCallback((time: number) => {
    setCurrentTime(time);
    seekRef.current?.(time);
  }, []);

  const isReady = liveStatus === 'READY';
  const isScriptReady = liveStatus === 'SCRIPT_READY';
  const isProcessing = !isReady && !isScriptReady && liveStatus !== 'FAILED';

  // Set body attribute for bottom padding when MiniPlayer is visible
  useEffect(() => {
    if (isReady && podcast.audioUrl) {
      document.body.setAttribute('data-mini-player', '');
    }
    return () => document.body.removeAttribute('data-mini-player');
  }, [isReady, podcast.audioUrl]);

  const backHref = isAuthenticated ? '/dashboard' : '/';
  const backLabel = isAuthenticated ? 'Dashboard' : 'Home';

  return (
    <>
      <PlayerBridge
        onTimeUpdate={(time) => {
          setCurrentTime(time);
        }}
        seekRef={seekRef}
      />
      <div className={styles.playerView}>
        {/* Back nav */}
        <nav className={styles.breadcrumb}>
          <Link href={backHref} className={styles.backLink}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            {backLabel}
          </Link>
        </nav>

        {/* Podcast Info */}
        <header className={styles.podcastHeader}>
          <h1 className={styles.podcastTitle}>{podcast.title}</h1>

          {podcast.topic && <p className={styles.podcastDescription}>{podcast.topic}</p>}

          <div className={styles.metaRow}>
            <div className={styles.creator}>
              <div className={styles.creatorAvatar}>
                {podcast.user.image ? (
                  <Image
                    src={podcast.user.image}
                    alt={podcast.user.name || 'Creator'}
                    width={32}
                    height={32}
                    className={styles.creatorAvatarImg}
                  />
                ) : (
                  <span className={styles.creatorAvatarFallback}>
                    {(podcast.user.name || podcast.user.handle || 'U')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <span className={styles.creatorName}>{podcast.user.name || 'Anonymous'}</span>
            </div>
            <span className={styles.metaDot} aria-hidden="true" />
            <time className={styles.metaDate} dateTime={podcast.createdAt}>
              {formatDate(podcast.createdAt)}
            </time>
            {podcast.duration && (
              <>
                <span className={styles.metaDot} aria-hidden="true" />
                <span className={styles.metaDuration}>{formatDuration(podcast.duration)}</span>
              </>
            )}
            {liveStatus !== 'READY' && (
              <Badge variant={statusVariants[liveStatus as PodcastStatus]}>
                {liveStatus.replace(/_/g, ' ')}
              </Badge>
            )}
            {isOwner && <VisibilityToggle podcastId={podcast.id} visibility={podcast.visibility} />}
          </div>

          <MetadataBadges podcast={podcast} />

          {podcast.tags.length > 0 && (
            <div className={styles.tags}>
              {podcast.tags.map((tag) => (
                <span key={tag.id} className={styles.tag}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* Failed state */}
        {liveStatus === 'FAILED' && (isOwner || isAdmin) && (
          <div className={styles.failedState}>
            {!retrying && (
              <>
                <p className={styles.failedText}>
                  {liveFailureReason || 'Generation failed.'} You can retry or delete this podcast.
                </p>
                {liveErrorId && (
                  <p className={styles.errorId}>
                    Error reference: <code>{liveErrorId}</code>
                  </p>
                )}
              </>
            )}
            {isAdmin && (
              <Link href={`/admin/podcasts?search=${podcast.id}`} className={styles.adminLink}>
                <Shield size={14} />
                View in Admin Panel
              </Link>
            )}
            {['GENERATING_AUDIO', 'STITCHING'].includes(liveFailedAtStatus ?? '') && (
              <AudioConfigPanel
                speakers={
                  scriptTurns?.map((t) => t.speaker).filter((s, i, a) => a.indexOf(s) === i) ?? [
                    'HOST',
                    'EXPERT',
                  ]
                }
                onConfigChange={setAudioConfig}
                failedProvider={podcast.ttsProvider}
              />
            )}
            <div className={styles.failedActions}>
              <Button onClick={handleRetry} loading={retrying} disabled={retrying || deleting}>
                {!retrying && <RefreshCw size={16} />}
                {retrying ? 'Retrying...' : 'Retry Generation'}
              </Button>
              {showDeleteConfirm ? (
                <div className={styles.deleteConfirm}>
                  <span className={styles.deleteConfirmText}>Are you sure?</span>
                  <Button
                    variant="danger"
                    onClick={handleDelete}
                    loading={deleting}
                    disabled={deleting}
                  >
                    <Trash2 size={16} />
                    {deleting ? 'Deleting...' : 'Yes, Delete'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={retrying}
                >
                  <Trash2 size={16} />
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Processing state */}
        {isProcessing && (
          <div className={styles.processingState}>
            <GenerationProgress
              status={liveStatus}
              topic={podcast.topic}
              verificationProgress={
                verificationProgress as
                  | import('@/types/podcast').VerificationProgressSnapshot
                  | null
              }
            />
          </div>
        )}

        {/* Script ready for review */}
        {isScriptReady && isOwner && (
          <div className={styles.scriptReadyState}>
            <GenerationProgress
              status={liveStatus}
              topic={podcast.topic}
              verificationProgress={
                verificationProgress as
                  | import('@/types/podcast').VerificationProgressSnapshot
                  | null
              }
            />
            {scriptTurns && scriptTurns.length > 0 && (
              <AudioConfigPanel
                speakers={[...new Set(scriptTurns.map((t) => t.speaker))]}
                onConfigChange={setAudioConfig}
              />
            )}
            {lowReferences && (
              <InsufficientRefsBanner
                refCount={podcast.references?.length ?? 0}
                requiredCount={requiredRefCount}
                podcastId={podcast.id}
                onRegenerate={() => {
                  setLowReferences(false);
                  setLiveStatus('SCRIPTING');
                }}
                verificationProgress={
                  verificationProgress as
                    | import('@/types/podcast').VerificationProgressSnapshot
                    | null
                }
              />
            )}
            <ScriptEditor
              podcastId={podcast.id}
              onApprove={() => setLiveStatus('GENERATING_AUDIO')}
              onRegenerate={() => setLiveStatus('SCRIPTING')}
              getApproveBody={() => {
                const body: Record<string, unknown> = {};
                const firstVoiceProvider = audioConfig.voices.find((v) => v.provider)?.provider;
                if (firstVoiceProvider) {
                  const [provider, ...modelParts] = firstVoiceProvider.split(':');
                  body.ttsProvider = provider;
                  if (modelParts.length) body.ttsModel = modelParts.join(':');
                }
                if (audioConfig.voices.length > 0) body.voices = audioConfig.voices;
                return body;
              }}
            />
          </div>
        )}

        {/* Video Section */}
        {isReady && isOwner && (
          <section className={styles.videoSection} aria-label="Video">
            <OwnerOnlyBadge />
            {videoState === 'idle' && (
              <>
                <div className={styles.ownerToolbar}>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => setShowModelPicker(true)}
                    disabled={
                      showModelPicker ||
                      pipelineLoading ||
                      videoLoading ||
                      (!videoStatus?.available && !isAdmin)
                    }
                    aria-label="Generate Video"
                    title="Generate a video from your podcast with AI visuals"
                    type="button"
                    data-loading={pipelineLoading || videoLoading ? 'true' : undefined}
                  >
                    <Video size={14} />
                    Video
                  </button>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => setShowAvatarPicker(true)}
                    disabled
                    aria-label="Add Avatars"
                    title="Generate a video first to add avatars"
                    type="button"
                  >
                    <Users size={14} />
                    Avatars
                  </button>
                </div>
                {showModelPicker && !videoError && (
                  <VideoModelPicker
                    onGenerate={(override) => {
                      setShowModelPicker(false);
                      handleGenerateVideo(override);
                    }}
                    onCancel={() => setShowModelPicker(false)}
                    loading={pipelineLoading}
                  />
                )}
                {videoError && (
                  <div className={styles.videoErrorBlock}>
                    <p className={styles.videoError}>{videoError.message}</p>
                    {videoError.isLlmError && (
                      <VideoModelPicker
                        onGenerate={(override) => {
                          setVideoError(null);
                          handleGenerateVideo(override);
                        }}
                        onCancel={() => setVideoError(null)}
                        loading={pipelineLoading}
                      />
                    )}
                  </div>
                )}
              </>
            )}
            {videoState === 'generating' && videoGenerationId && (
              <VideoProgress
                podcastId={podcast.id}
                videoGenerationId={videoGenerationId}
                onComplete={(visuals) => {
                  setVideoState('ready');
                  setSegmentVisuals(visuals);
                }}
                onRequestEdit={async (visuals) => {
                  setSegmentVisuals(visuals as SegmentVisualData[]);
                  if (!falModels) {
                    const res = await fetch('/api/v1/fal-models');
                    if (res.ok) setFalModels(await res.json());
                  }
                  setVideoState('failed');
                  setShowVideoEditor(true);
                }}
                onChangeAvatars={() => {
                  setShowAvatarPicker(true);
                }}
                onDismiss={dismissVideoError}
              />
            )}
            {videoState === 'ready' && (
              <div className={styles.ownerToolbar}>
                <button
                  className={styles.toolbarBtn}
                  onClick={async () => {
                    if (!falModels) {
                      const res = await fetch('/api/v1/fal-models');
                      if (res.ok) setFalModels(await res.json());
                    }
                    setShowVideoEditor(true);
                  }}
                  aria-label="Edit Storyboard"
                  title="Edit the video storyboard — change visuals, transitions, and timing"
                  type="button"
                >
                  <Pencil size={14} />
                  Storyboard
                </button>
                <button
                  className={styles.toolbarBtn}
                  onClick={() => setShowAvatarPicker(true)}
                  disabled={!avatarGenerating && !avatarDone && !avatarStatus?.available}
                  aria-label={
                    avatarGenerating
                      ? 'Generating avatars'
                      : avatarDone
                        ? 'Avatars ready'
                        : avatarOverlays.length > 0
                          ? 'Change Avatars'
                          : 'Add Avatars'
                  }
                  title={
                    avatarGenerating
                      ? 'Generating avatars...'
                      : avatarOverlays.length > 0
                          ? 'Change the speaker avatars'
                          : 'Add AI-generated speaker avatars'
                  }
                  type="button"
                  data-loading={avatarGenerating ? 'true' : undefined}
                  data-done={avatarDone ? 'true' : undefined}
                >
                  {avatarDone ? (
                    <>
                      <Check size={14} />
                      Ready!
                    </>
                  ) : avatarGenerating ? (
                    <>
                      <RefreshCw size={14} />
                      {(() => {
                        const rw = avatarOverlays.find(
                          (o) => o.avatarProvider === 'runway' && (o.runwayTotalChunks ?? 0) > 1
                        );
                        if (rw) return `Chunk ${rw.runwayChunkIndex ?? 0}/${rw.runwayTotalChunks}`;
                        return `${avatarOverlays.filter((o) => o.status === 'ready').length}/${avatarOverlays.length}`;
                      })()}
                    </>
                  ) : (
                    <>
                      <Users size={14} />
                      Avatars
                    </>
                  )}
                </button>
              </div>
            )}
            {videoState === 'failed' && (
              <>
                <div className={styles.videoFailed}>
                  <button
                    className={styles.videoDismiss}
                    onClick={dismissVideoError}
                    type="button"
                    aria-label="Dismiss error"
                  >
                    <X size={16} />
                  </button>
                  <p className={styles.videoError}>
                    {videoError?.message || 'Video generation failed.'}
                  </p>
                </div>
                <div className={styles.ownerToolbar}>
                  <button
                    className={styles.toolbarBtn}
                    onClick={async () => {
                      const [falRes, visualRes] = await Promise.all([
                        !falModels ? fetch('/api/v1/fal-models') : Promise.resolve(null),
                        segmentVisuals.length === 0
                          ? fetch(`/api/v1/podcasts/${podcast.id}/video`)
                          : Promise.resolve(null),
                      ]);
                      if (falRes?.ok) setFalModels(await falRes.json());
                      if (visualRes?.ok) {
                        const d = (await visualRes.json()) as {
                          segmentVisuals?: SegmentVisualData[];
                        };
                        if (d.segmentVisuals?.length) setSegmentVisuals(d.segmentVisuals);
                      }
                      setShowVideoEditor(true);
                    }}
                    aria-label="Edit Storyboard"
                    title="Edit the video storyboard to fix the issue"
                    type="button"
                  >
                    <Pencil size={14} />
                    Storyboard
                  </button>
                  <button
                    className={styles.toolbarBtn}
                    disabled={videoLoading}
                    onClick={async () => {
                      setVideoLoading(true);
                      setVideoError(null);
                      try {
                        const res = await fetch(`/api/v1/podcasts/${podcast.id}/video`, {
                          method: 'POST',
                        });
                        if (!res.ok) {
                          const body = (await res.json().catch(() => ({}))) as { error?: string };
                          setVideoError({ message: body.error || 'Retry failed.' });
                          return;
                        }
                        const data = (await res.json()) as {
                          videoGenerationId: string;
                          status: string;
                        };
                        setVideoGenerationId(data.videoGenerationId);
                        setVideoState('generating');
                      } catch {
                        setVideoError({ message: 'Network error — could not retry.' });
                      } finally {
                        setVideoLoading(false);
                      }
                    }}
                    aria-label="Retry Video"
                    title="Retry video generation"
                    type="button"
                  >
                    <RefreshCw size={14} />
                    Retry
                  </button>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => setShowAvatarPicker(true)}
                    disabled
                    aria-label="Avatars"
                    title="Retry video generation first to add avatars"
                    type="button"
                  >
                    <Users size={14} />
                    Avatars
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* Player — immediately after owner tools */}
        {isReady && podcast.audioUrl && (
          <section
            ref={playerSectionRef}
            className={styles.playerSection}
            aria-label="Audio player"
          >
            <AudioPlayer
              podcastId={podcast.id}
              audioUrl={podcast.audioUrl!}
              podcastTitle={podcast.title}
            />
          </section>
        )}

        {/* Stats & Actions */}
        <div className={styles.actionsRow}>
          {isOwner && (
            <div className={styles.statsRow}>
              <span className={styles.stat}>
                <Play size={16} aria-hidden="true" />
                {formatCount(podcast.playCount)}
              </span>
              <OwnerOnlyBadge />
            </div>
          )}

          <div className={styles.actionButtons}>
            {isReady && isAuthenticated && (
              <button
                className={styles.actionBtn}
                onClick={handleInterrupt}
                aria-label="Ask a question"
                type="button"
              >
                <MessageCircleQuestion size={18} />
                <span>Ask</span>
              </button>
            )}

            {showDeleteConfirm ? (
              <div className={styles.deleteConfirm}>
                <span className={styles.deleteConfirmText}>Delete?</span>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                  onClick={handleDelete}
                  disabled={deleting}
                  type="button"
                  aria-label="Confirm delete"
                >
                  <Trash2 size={18} />
                  <span>{deleting ? 'Deleting...' : 'Yes'}</span>
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  type="button"
                >
                  <span>Cancel</span>
                </button>
              </div>
            ) : (
              <OverflowMenu
                triggerClassName={styles.actionBtn}
                items={[
                  ...(isOwner
                    ? [
                        {
                          icon: <Pencil size={16} />,
                          label: 'Edit',
                          onClick: () => router.push(`/podcast/${podcast.id}/edit`),
                        },
                      ]
                    : []),
                  ...(isReady && isAuthenticated
                    ? [
                        {
                          icon: pdfLoading ? (
                            <FileText size={16} />
                          ) : pdfUrl ? (
                            <Download size={16} />
                          ) : (
                            <FileText size={16} />
                          ),
                          label: pdfLoading ? 'Generating PDF...' : 'PDF Transcript',
                          onClick: handleExportPdf,
                        },
                      ]
                    : []),
                  ...(isOwner && liveStatus !== 'FAILED'
                    ? [
                        {
                          icon: <Trash2 size={16} />,
                          label: 'Delete',
                          onClick: () => setShowDeleteConfirm(true),
                          danger: true,
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </div>
        </div>

        {/* Collapsible details: Version History */}
        {(() => {
          const hasVersions = podcast.versions.length > 1;
          const hasDetails = hasVersions;
          if (!hasDetails) return null;
          return (
            <details className={styles.detailsSection}>
              <summary className={styles.detailsSummary}>More details</summary>
              <div className={styles.detailsContent}>
                {hasVersions && (
                  <VersionHistory
                    versions={podcast.versions}
                    currentVersion={podcast.currentVersion}
                  />
                )}
              </div>
            </details>
          );
        })()}

        {/* View Toggle + Transcript/Teleprompter */}
        {podcast.segments.length > 0 && (
          <details className={styles.detailsSection} open={segmentVisuals.length > 0 || undefined}>
            <summary className={styles.detailsSummary}>
              <div className={styles.viewToggle} role="tablist" aria-label="Transcript view mode">
                {segmentVisuals.length > 0 && (
                  <button
                    className={`${styles.viewToggleBtn} ${viewMode === 'video' ? styles.viewToggleBtnActive : styles.viewToggleBtnHighlight}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setViewMode('video');
                    }}
                    role="tab"
                    aria-selected={viewMode === 'video'}
                    type="button"
                  >
                    Video
                  </button>
                )}
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === 'transcript' ? styles.viewToggleBtnActive : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setViewMode('transcript');
                  }}
                  role="tab"
                  aria-selected={viewMode === 'transcript'}
                  type="button"
                >
                  Transcript
                </button>
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === 'teleprompter' ? styles.viewToggleBtnActive : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setViewMode('teleprompter');
                  }}
                  role="tab"
                  aria-selected={viewMode === 'teleprompter'}
                  type="button"
                >
                  Teleprompter
                </button>
              </div>
            </summary>

            <div className={styles.detailsContent}>
              <section className={styles.transcriptSection}>
                {viewMode === 'transcript' ? (
                  <TranscriptPanel
                    segments={podcast.segments}
                    references={podcast.references}
                    vocabularyEntries={podcast.vocabularyEntries}
                    currentTime={currentTime}
                    onSegmentClick={handleSegmentClick}
                  />
                ) : viewMode === 'teleprompter' ? (
                  <Teleprompter
                    segments={podcast.segments}
                    references={podcast.references}
                    currentTime={currentTime}
                    onSegmentClick={handleSegmentClick}
                  />
                ) : segmentVisuals.length > 0 ? (
                  <VideoView
                    segments={podcast.segments}
                    segmentVisuals={segmentVisuals}
                    references={podcast.references}
                    currentTime={currentTime}
                    onSegmentClick={handleSegmentClick}
                    title={podcast.title}
                    avatarOverlays={filteredAvatarOverlays}
                    isOwner={isOwner}
                    avatarsVisible={avatarsVisible}
                    onAvatarsVisibleChange={async (visible) => {
                      setAvatarsVisible(visible);
                      await fetch(`/api/v1/podcasts/${podcast.id}/video`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avatarsVisible: visible }),
                      });
                    }}
                    onAvatarPositionChange={handleAvatarPositionChange}
                    onMaskShapeChange={handleMaskShapeChange}
                  />
                ) : null}
              </section>
            </div>
          </details>
        )}

        {/* References — after transcript/video */}
        {podcast.references.length > 0 && (
          <section className={styles.referencesSection}>
            <ReferenceList references={podcast.references} />
          </section>
        )}

        {/* Vocabulary — after references (language learning podcasts) */}
        {podcast.vocabularyEntries && podcast.vocabularyEntries.length > 0 && (
          <section className={styles.referencesSection}>
            <VocabularyList vocabularyEntries={podcast.vocabularyEntries} />
          </section>
        )}

        {/* Interrupt Chat (opened from action bar) */}
        {showInterruptChat && (
          <InterruptChatPanel
            podcastId={podcast.id}
            isOwner={isOwner}
            podcastSource={podcast.source}
            currentTime={currentTime}
            existingInteractions={podcast.interactions}
            onClose={() => setShowInterruptChat(false)}
          />
        )}

        {/* Verification mode badge */}
        {podcast.verificationMode === 'relaxed' && (
          <div
            className={styles.verificationBadge}
            title="This podcast uses relaxed fact-checking at the creator's request. Claims may not be fully sourced."
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Lightly verified
          </div>
        )}

        {podcast.lowReferences && (
          <div
            className={styles.limitedSourcesBadge}
            aria-label="Limited Sources"
            title="This podcast has fewer verified references than recommended. Some claims may not be backed by cited sources."
          >
            <AlertTriangle size={14} aria-hidden="true" />
            Limited Sources ({podcast.references.length} verified)
          </div>
        )}

        {/* Made with Sotto */}
        {!isOwner && podcast.visibility === 'PUBLIC' && (
          <div className={styles.badgeSection}>
            <SottoBadge />
          </div>
        )}

        {/* Avatar Picker Modal */}
        <Modal
          isOpen={showAvatarPicker}
          onClose={() => setShowAvatarPicker(false)}
          title="Speaker Avatars"
          size="large"
        >
          <AvatarPicker
            podcastId={podcast.id}
            speakers={[...new Set(podcast.segments.map((s) => s.speaker))]}
            segments={podcast.segments}
            existingOverlays={
              avatarOverlays.length > 0
                ? avatarOverlays.map((ov) => ({
                    speaker: ov.speaker,
                    avatarId: ov.avatarId,
                    avatarProvider: (ov.avatarProvider ?? 'heygen') as 'heygen' | 'runway' | 'fal',
                    status: ov.status,
                  }))
                : undefined
            }
            onConfigured={({ generationStarted }) => {
              setShowAvatarPicker(false);
              if (generationStarted) {
                setAvatarGenerating(true);
              }
            }}
            onCancel={() => setShowAvatarPicker(false)}
          />
        </Modal>

        {/* Pipeline Editor Modal (pre-generation storyboard) */}
        <Modal
          isOpen={showPipelineEditor && !!pipelineData && !!falModels}
          onClose={() => {
            setShowPipelineEditor(false);
          }}
          title="Video Storyboard"
          size="large"
        >
          {pipelineData && falModels && (
            <PipelineEditor
              podcastId={podcast.id}
              podcastTitle={podcast.title}
              pipeline={pipelineData}
              falModels={falModels}
              onApprove={handlePipelineApprove}
              onCancel={(edited) => {
                setPipelineData(edited);
                setShowPipelineEditor(false);
                // Persist edits to DRAFT (fire-and-forget via PATCH)
                fetch(`/api/v1/podcasts/${podcast.id}/video/pipeline`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(edited),
                }).catch(() => {});
              }}
              onReclassify={() => {
                setPipelineData(null);
                setShowPipelineEditor(false);
                handleGenerateVideo(undefined, true);
              }}
            />
          )}
        </Modal>

        {/* Video Editor Modal (post-generation storyboard) */}
        <Modal
          isOpen={
            showVideoEditor && (videoState === 'ready' || videoState === 'failed') && !!falModels
          }
          onClose={() => setShowVideoEditor(false)}
          title="Edit Storyboard"
          size="xlarge"
        >
          {falModels && (
            <VideoEditor
              podcastId={podcast.id}
              segments={podcast.segments}
              segmentVisuals={segmentVisuals}
              falModels={falModels}
              voices={[]}
              onRegenerate={(genId) => {
                setShowVideoEditor(false);
                setVideoState('generating');
                setVideoGenerationId(genId);
              }}
              onCancel={() => setShowVideoEditor(false)}
            />
          )}
        </Modal>

      </div>

      {/* Persistent footer mini-player */}
      {isReady && podcast.audioUrl && (
        <MiniPlayer
          podcastTitle={podcast.title}
          onExpand={() => playerSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
        />
      )}
    </>
  );
}
