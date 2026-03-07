'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  Heart,
  Bookmark,
  GitFork,
  Mic,
  Play,
  FileText,
  Download,
  Pencil,
  RefreshCw,
  ListMusic,
  Trash2,
  Check,
  Flag,
  BarChart2,
  Shield,
  Video,
} from 'lucide-react';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { AudioPlayer } from '@/components/player/AudioPlayer';
import { TranscriptPanel } from '@/components/player/TranscriptPanel';
import { Teleprompter } from '@/components/player/Teleprompter';
import { ReferenceList } from '@/components/player/ReferenceList';
import { InterruptButton } from '@/components/player/InterruptButton';
import { VoiceQABadge } from '@/components/player/VoiceQABadge';
import { InterruptChatPanel } from '@/components/player/InterruptChatPanel';
import { ForkAttribution } from '@/components/player/ForkAttribution';
import { ForkLineage } from '@/components/player/ForkLineage';
import { ForkGraph } from '@/components/player/ForkGraph';
import { ForkRemixModal } from '@/components/player/ForkRemixModal';
import { VoiceRenditionForkModal } from '@/components/player/VoiceRenditionForkModal';
import { ProposeRenditionButton } from '@/components/player/ProposeRenditionButton';
import { Contributors } from '@/components/player/Contributors';
import { AddToCollectionModal } from '@/components/collections/AddToCollectionModal';
import { ShareMenu } from '@/components/player/ShareMenu';
import { OverflowMenu } from '@/components/ui/OverflowMenu';
import { ReportModal } from '@/components/ui/ReportModal';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { VoiceTrackSelector } from '@/components/player/VoiceTrackSelector';
import { VersionHistory } from '@/components/player/VersionHistory';
import { CommunityQuestions } from '@/components/player/CommunityQuestions';
import { CommentSection } from '@/components/player/CommentSection';
import { PostListenRating } from '@/components/player/PostListenRating';
import { Badge } from '@/components/ui/Badge';
import { SottoBadge } from '@/components/ui/SottoBadge';
import { MetadataBadges } from '@/components/ui/MetadataBadges';
import { Button } from '@/components/ui/Button';
import { GenerationProgress } from '@/components/create/GenerationProgress';
import { ScriptPreview } from '@/components/player/ScriptPreview';
import { AudioConfigPanel, type AudioConfig } from '@/components/player/AudioConfigPanel';
import { MiniPlayer } from '@/components/player/MiniPlayer';
import { VideoProgress } from '@/components/player/VideoProgress';
import { VideoView } from '@/components/player/VideoView';
import { PipelineEditor } from '@/components/player/PipelineEditor';
import type { PodcastDetail } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';
import type { VideoPipeline, FalModelsResponse } from '@/types/pipeline';
import type { PodcastStatus } from '@prisma/client';
import { profileUrl } from '@/lib/urls';
import styles from './page.module.css';

interface PodcastPlayerViewProps {
  podcast: PodcastDetail;
  isOwner: boolean;
  isAdmin?: boolean;
  isAuthenticated: boolean;
  currentUserId?: string;
  canMakePrivate?: boolean;
  canGenerateVideo?: boolean;
}

type ViewMode = 'transcript' | 'teleprompter' | 'video';

const statusVariants: Record<PodcastStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> =
  {
    DRAFT: 'default',
    PENDING: 'default',
    DISCOVERING: 'info',
    EXTRACTING: 'info',
    SCRIPTING: 'info',
    VERIFYING_SCRIPT: 'info',
    VALIDATING_REFERENCES: 'info',
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

export function PodcastPlayerView({ podcast, isOwner, isAdmin, isAuthenticated, currentUserId, canMakePrivate, canGenerateVideo }: PodcastPlayerViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [liked, setLiked] = useState(podcast.isLiked);
  const [likeCount, setLikeCount] = useState(podcast.likeCount);
  const [saved, setSaved] = useState(podcast.isSaved);
  const [currentTime, setCurrentTime] = useState(0);
  const seekRef = useRef<((time: number) => void) | null>(null);
  const [showInterruptChat, setShowInterruptChat] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('transcript');
  const [pdfUrl, setPdfUrl] = useState<string | null>(podcast.pdfUrl);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showForkRemix, setShowForkRemix] = useState(
    searchParams.get('fork') === '1' && !isOwner && isAuthenticated
  );
  const [showReVoice, setShowReVoice] = useState(false);
  const [showAddToCollection, setShowAddToCollection] = useState(false);
  const [liveStatus, setLiveStatus] = useState(podcast.status);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [approving, setApproving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState('');
  const [scriptTurns, setScriptTurns] = useState<Array<{ speaker: string; text: string }> | null>(null);
  const [scriptRefs, setScriptRefs] = useState<ReferenceData[]>([]);
  const [audioConfig, setAudioConfig] = useState<AudioConfig>({ ttsProvider: undefined, ttsModel: undefined, voices: [] });
  const playerSectionRef = useRef<HTMLElement>(null);
  const [playerInView, setPlayerInView] = useState(true);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const completionPercentRef = useRef(0);
  const [questionCounts, setQuestionCounts] = useState<Map<number, number>>(new Map());
  const [questionsRefreshTrigger, setQuestionsRefreshTrigger] = useState(0);
  const [videoState, setVideoState] = useState<'idle' | 'generating' | 'ready' | 'failed'>(
    podcast.videoUrl ? 'ready' : 'idle'
  );
  const [segmentVisuals, setSegmentVisuals] = useState<Array<{
    segmentId: string;
    visualType: string;
    prompt: string | null;
    metadata: Record<string, unknown> | null;
    assetUrl: string | null;
    assetType: string | null;
    order: number;
  }>>([]);
  const [videoGenerationId, setVideoGenerationId] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [pipelineData, setPipelineData] = useState<VideoPipeline | null>(null);
  const [showPipelineEditor, setShowPipelineEditor] = useState(false);
  const [falModels, setFalModels] = useState<FalModelsResponse | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [lineageData, setLineageData] = useState<{
    ancestors: Array<{
      id: string;
      title: string;
      user: { name: string | null; handle: string | null };
    }>;
    forks: Array<{
      id: string;
      title: string;
      isVoiceOnlyFork?: boolean;
      user: { name: string | null; handle: string | null };
    }>;
  } | null>(null);

  // Check if user has already rated this podcast
  useEffect(() => {
    if (!isAuthenticated || liveStatus !== 'READY') return;
    fetch(`/api/podcasts/${podcast.id}/rating`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.rating) setHasRated(true);
      })
      .catch(() => {});
  }, [isAuthenticated, liveStatus, podcast.id]);

  // Fetch knowledge gaps for owner
  useEffect(() => {
    if (!isOwner || podcast.status !== 'READY') return;
    fetch(`/api/podcasts/${podcast.id}/knowledge-gaps`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.segments) {
          const counts = new Map<number, number>();
          for (const seg of data.segments) {
            counts.set(seg.segmentOrder, seg.questionCount);
          }
          setQuestionCounts(counts);
        }
      })
      .catch(() => {});
  }, [isOwner, podcast.id, podcast.status]);

  // Fetch script turns for review when SCRIPT_READY or FAILED (for AudioConfigPanel speakers)
  const needsScript = liveStatus === 'SCRIPT_READY' || (liveStatus === 'FAILED' && ['GENERATING_AUDIO', 'STITCHING'].includes(podcast.failedAtStatus ?? ''));
  useEffect(() => {
    if (!needsScript || !isOwner) return;
    fetch(`/api/podcasts/${podcast.id}/script`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.turns) setScriptTurns(data.turns);
        if (data?.references) setScriptRefs(data.references);
      })
      .catch(() => {});
  }, [needsScript, isOwner, podcast.id]);

  // Poll for status updates while podcast is processing
  useEffect(() => {
    if (liveStatus === 'READY' || liveStatus === 'FAILED' || liveStatus === 'SCRIPT_READY') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/podcasts/${podcast.id}`);
        if (!res.ok) return;
        const data = await res.json();
        setLiveStatus(data.status);
        if (data.status === 'READY') {
          router.refresh();
        }
      } catch {
        // Silently retry next interval
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [podcast.id, liveStatus, router]);

  // Fetch fork lineage for ForkGraph
  useEffect(() => {
    if (!podcast.forkedFrom && podcast.forks.length === 0) return;
    fetch(`/api/podcasts/${podcast.id}/lineage`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setLineageData(data);
      })
      .catch(() => {});
  }, [podcast.id, podcast.forkedFrom, podcast.forks.length]);

  // Show mini-player when main player scrolls out of view
  useEffect(() => {
    const el = playerSectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPlayerInView(entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [liveStatus]);

  // Check existing video generation status on mount
  useEffect(() => {
    if (!isOwner || liveStatus !== 'READY') return;
    fetch(`/api/podcasts/${podcast.id}/video`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.status) return;
        if (data.status === 'READY' && data.segmentVisuals?.length > 0) {
          setVideoState('ready');
          setSegmentVisuals(data.segmentVisuals);
        } else if (data.status === 'FAILED') {
          setVideoState('failed');
          setVideoError(data.failureReason || 'Video generation failed.');
        } else {
          setVideoState('generating');
          setVideoGenerationId(data.videoGenerationId);
        }
      })
      .catch(() => {});
  }, [isOwner, liveStatus, podcast.id]);

  // Fall back to transcript if video tab is active but no visuals available
  useEffect(() => {
    if (segmentVisuals.length === 0 && viewMode === 'video') {
      setViewMode('transcript');
    }
  }, [segmentVisuals, viewMode]);

  const handleGenerateVideo = useCallback(async () => {
    setPipelineLoading(true);
    setVideoError(null);
    try {
      const [pipelineRes, modelsRes] = await Promise.all([
        fetch(`/api/podcasts/${podcast.id}/video/pipeline`, { method: 'POST' }),
        fetch('/api/fal-models'),
      ]);
      if (!pipelineRes.ok) {
        const err = await pipelineRes.json().catch(() => ({}));
        setVideoError(err.error || 'Failed to create pipeline.');
        return;
      }
      if (!modelsRes.ok) {
        setVideoError('Failed to load available models.');
        return;
      }
      const pipeline: VideoPipeline = await pipelineRes.json();
      const models: FalModelsResponse = await modelsRes.json();
      setPipelineData(pipeline);
      setFalModels(models);
      setShowPipelineEditor(true);
    } catch {
      setVideoError('Failed to create pipeline.');
    } finally {
      setPipelineLoading(false);
    }
  }, [podcast.id]);

  const handlePipelineApprove = useCallback(
    async (pipeline: VideoPipeline) => {
      setShowPipelineEditor(false);
      setVideoState('generating');
      setVideoLoading(true);
      try {
        const res = await fetch(`/api/podcasts/${podcast.id}/video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pipeline }),
        });
        if (!res.ok) throw new Error('Failed to start video generation');
        const data = await res.json();
        setVideoGenerationId(data.videoGenerationId);
      } catch (err) {
        setVideoState('failed');
        setVideoError(err instanceof Error ? err.message : 'Generation failed');
      } finally {
        setVideoLoading(false);
      }
    },
    [podcast.id],
  );

  const handleLike = useCallback(async () => {
    if (!isAuthenticated) return;
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount((c) => c + (newLiked ? 1 : -1));
    try {
      await fetch(`/api/podcasts/${podcast.id}/like`, {
        method: newLiked ? 'POST' : 'DELETE',
      });
    } catch {
      setLiked(!newLiked);
      setLikeCount((c) => c + (newLiked ? -1 : 1));
    }
  }, [liked, isAuthenticated, podcast.id]);

  const handleSave = useCallback(async () => {
    if (!isAuthenticated) return;
    const newSaved = !saved;
    setSaved(newSaved);
    try {
      await fetch(`/api/podcasts/${podcast.id}/save`, {
        method: newSaved ? 'POST' : 'DELETE',
      });
    } catch {
      setSaved(!newSaved);
    }
  }, [saved, isAuthenticated, podcast.id]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const body: Record<string, unknown> = {};
      if (audioConfig.ttsProvider) {
        body.ttsProvider = audioConfig.ttsProvider;
        body.ttsModel = audioConfig.ttsModel;
      }
      const response = await fetch(`/api/podcasts/${podcast.id}/generate`, {
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
      const response = await fetch(`/api/podcasts/${podcast.id}`, {
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

  const handleApproveScript = useCallback(async () => {
    setApproving(true);
    try {
      const body: Record<string, unknown> = {};
      if (audioConfig.ttsProvider) {
        body.ttsProvider = audioConfig.ttsProvider;
        body.ttsModel = audioConfig.ttsModel;
      }
      if (audioConfig.voices.length > 0) {
        body.voices = audioConfig.voices;
      }
      const response = await fetch(`/api/podcasts/${podcast.id}/script/approve`, {
        method: 'POST',
        ...(Object.keys(body).length > 0
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      if (response.ok) {
        setLiveStatus('GENERATING_AUDIO');
      }
    } catch {
      // ignore
    } finally {
      setApproving(false);
    }
  }, [podcast.id, audioConfig]);

  const handleRegenerateScript = useCallback(async () => {
    setRegenerating(true);
    try {
      const feedbackText = regenerateFeedback.trim();
      const response = await fetch(`/api/podcasts/${podcast.id}/script/regenerate`, {
        method: 'POST',
        ...(feedbackText ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: feedbackText }),
        } : {}),
      });
      if (response.ok) {
        setLiveStatus('SCRIPTING');
        setRegenerateFeedback('');
      }
    } catch {
      // ignore
    } finally {
      setRegenerating(false);
    }
  }, [podcast.id, regenerateFeedback]);

  const handleExportPdf = useCallback(async () => {
    if (!isAuthenticated) return;

    // If PDF already available, open it
    if (pdfUrl) {
      window.open(pdfUrl, '_blank');
      return;
    }

    setPdfLoading(true);
    try {
      const response = await fetch(`/api/podcasts/${podcast.id}/export`, {
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
          const pollResponse = await fetch(`/api/podcasts/${podcast.id}/export`);
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

  return (
    <>
    <PlayerBridge
      onTimeUpdate={(time) => {
        setCurrentTime(time);
        if (podcast.duration && podcast.duration > 0) {
          completionPercentRef.current = Math.min((time / podcast.duration) * 100, 100);
        }
      }}
      seekRef={seekRef}
      onComplete={() => {
        if (isAuthenticated && !hasRated) setShowRatingPrompt(true);
      }}
    />
    <div className={styles.playerView}>
      {/* Back nav */}
      <nav className={styles.breadcrumb}>
        <Link href="/feed" className={styles.backLink}>
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
          Feed
        </Link>
      </nav>

      {/* Podcast Info */}
      <header className={styles.podcastHeader}>
        <h1 className={styles.podcastTitle}>{podcast.title}</h1>

        {podcast.topic && (
          <p className={styles.podcastDescription}>{podcast.topic}</p>
        )}

        <div className={styles.metaRow}>
          <Link href={profileUrl(podcast.user)} className={styles.creator}>
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
          </Link>
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
          {isOwner && (
            <VisibilityToggle podcastId={podcast.id} visibility={podcast.visibility} canMakePrivate={canMakePrivate} />
          )}
        </div>

        <MetadataBadges podcast={podcast} />

        {podcast.tags.length > 0 && (
          <div className={styles.tags}>
            {podcast.tags.map((tag) => (
              <Link key={tag.id} href={`/feed?tag=${tag.slug}`} className={styles.tag}>
                {tag.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* Fork Attribution */}
      {podcast.forkedFrom && <ForkAttribution forkedFrom={podcast.forkedFrom} />}

      {/* Failed state */}
      {liveStatus === 'FAILED' && (isOwner || isAdmin) && (
        <div className={styles.failedState}>
          {!retrying && (
            <>
              <p className={styles.failedText}>
                {podcast.failureReason || 'Generation failed.'} You can retry or delete this podcast.
              </p>
              {podcast.errorId && (
                <p className={styles.errorId}>
                  Error reference: <code>{podcast.errorId}</code>
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
          {['GENERATING_AUDIO', 'STITCHING'].includes(podcast.failedAtStatus ?? '') && (
            <AudioConfigPanel
              speakers={scriptTurns?.map((t) => t.speaker).filter((s, i, a) => a.indexOf(s) === i) ?? ['HOST', 'EXPERT']}
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
                <Button variant="danger" onClick={handleDelete} loading={deleting} disabled={deleting}>
                  <Trash2 size={16} />
                  {deleting ? 'Deleting...' : 'Yes, Delete'}
                </Button>
                <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowDeleteConfirm(true)} disabled={retrying}>
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
          <GenerationProgress status={liveStatus} topic={podcast.topic} />
        </div>
      )}

      {/* Script ready for review */}
      {isScriptReady && isOwner && (
        <div className={styles.scriptReadyState}>
          <GenerationProgress status={liveStatus} topic={podcast.topic} />
          <p className={styles.scriptReadyText}>
            Your script is ready for review. Approve to start audio generation, or regenerate for a fresh script.
          </p>
          {scriptTurns && scriptTurns.length > 0 && (
            <>
              <ScriptPreview turns={scriptTurns} references={scriptRefs} podcastId={podcast.id} />
              <AudioConfigPanel
                speakers={[...new Set(scriptTurns.map((t) => t.speaker))]}
                onConfigChange={setAudioConfig}
              />
            </>
          )}
          <textarea
            className={styles.regenerateFeedback}
            value={regenerateFeedback}
            onChange={(e) => setRegenerateFeedback(e.target.value)}
            placeholder="Optional: describe what you'd like changed before regenerating..."
            rows={3}
            maxLength={5000}
            aria-label="Feedback for script regeneration"
          />
          <div className={styles.scriptReadyActions}>
            <Button onClick={handleApproveScript} loading={approving} disabled={approving || regenerating}>
              <Check size={16} />
              {approving ? 'Approving...' : 'Approve & Generate Audio'}
            </Button>
            <Button variant="secondary" onClick={handleRegenerateScript} loading={regenerating} disabled={approving || regenerating}>
              <RefreshCw size={16} />
              {regenerating ? 'Regenerating...' : (regenerateFeedback.trim() ? 'Regenerate with Notes' : 'Regenerate Script')}
            </Button>
          </div>
        </div>
      )}

      {/* Player */}
      {isReady && podcast.audioUrl && (
        <section ref={playerSectionRef} className={styles.playerSection} aria-label="Audio player">
          <AudioPlayer podcastId={podcast.id} audioUrl={podcast.audioUrl!} podcastTitle={podcast.title} />
          {(podcast.voiceTracks.length > 0 || isOwner) && (
            <VoiceTrackSelector
              podcastId={podcast.id}
              podcastAudioUrl={podcast.audioUrl!}
              podcastTitle={podcast.title}
              voiceTracks={podcast.voiceTracks}
              defaultVoiceTrackId={podcast.defaultVoiceTrackId}
              isOwner={isOwner}
            />
          )}
          {isOwner && podcast.isVoiceOnlyFork && podcast.forkedFrom && isReady &&
            podcast.voiceTracks.some(t => t.status === 'READY') && (
            <ProposeRenditionButton
              podcastId={podcast.id}
              voiceTrackId={podcast.voiceTracks.find(t => t.status === 'READY')!.id}
              originalPodcastId={podcast.forkedFrom.id}
              originalTitle={podcast.forkedFrom.title}
            />
          )}
        </section>
      )}

      {/* Video Section */}
      {isReady && isOwner && (
        <section className={styles.videoSection} aria-label="Video">
          {videoState === 'idle' && !showPipelineEditor && (
            <div className={styles.videoIdle}>
              <Button
                onClick={handleGenerateVideo}
                loading={pipelineLoading || videoLoading}
                disabled={pipelineLoading || videoLoading || !canGenerateVideo}
              >
                <Video size={16} />
                Generate Video
              </Button>
              {!canGenerateVideo && !isAdmin && (
                <Badge variant="warning">PRO</Badge>
              )}
              {videoError && <p className={styles.videoError}>{videoError}</p>}
            </div>
          )}
          {showPipelineEditor && pipelineData && falModels && (
            <PipelineEditor
              podcastId={podcast.id}
              podcastTitle={podcast.title}
              pipeline={pipelineData}
              falModels={falModels}
              onApprove={handlePipelineApprove}
              onCancel={() => {
                setShowPipelineEditor(false);
                setPipelineData(null);
              }}
            />
          )}
          {videoState === 'generating' && videoGenerationId && (
            <VideoProgress
              podcastId={podcast.id}
              videoGenerationId={videoGenerationId}
              onComplete={(visuals) => {
                setVideoState('ready');
                setSegmentVisuals(visuals);
              }}
            />
          )}
          {videoState === 'failed' && (
            <div className={styles.videoFailed}>
              <p className={styles.videoError}>{videoError || 'Video generation failed.'}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setVideoState('idle');
                  setVideoError(null);
                }}
              >
                <RefreshCw size={16} />
                Retry
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Post-Listen Rating Prompt */}
      {showRatingPrompt && !hasRated && (
        <PostListenRating
          podcastId={podcast.id}
          isOwner={isOwner}
          completionPercent={completionPercentRef.current}
          onDismiss={() => {
            setShowRatingPrompt(false);
            setHasRated(true);
          }}
        />
      )}

      {/* Stats & Actions */}
      <div className={styles.actionsRow}>
        {isOwner && (
          <div className={styles.statsRow}>
            <span className={styles.stat}>
              <Play size={16} aria-hidden="true" />
              {formatCount(podcast.playCount)}
            </span>
            <span className={styles.stat}>
              <Heart size={16} aria-hidden="true" />
              {formatCount(likeCount)}
            </span>
            <span className={styles.stat}>
              <GitFork size={16} aria-hidden="true" />
              {formatCount(podcast.forkCount)}
            </span>
          </div>
        )}

        <div className={styles.actionButtons}>
          {/* Primary actions — always visible */}
          <button
            className={`${styles.actionBtn} ${liked ? styles.actionBtnActive : ''}`}
            onClick={handleLike}
            aria-label={liked ? 'Unlike' : 'Like'}
            aria-pressed={liked}
            type="button"
          >
            <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
            <span>{liked ? 'Liked' : 'Like'}</span>
          </button>
          {!isOwner && isAuthenticated && (
            <button
              className={styles.actionBtn}
              onClick={() => setShowForkRemix(true)}
              aria-label="Fork & remix this podcast"
              type="button"
            >
              <GitFork size={18} />
              <span>Fork</span>
            </button>
          )}
          {!isOwner && isAuthenticated && isReady && (
            <button
              className={styles.actionBtn}
              onClick={() => setShowReVoice(true)}
              aria-label="Re-voice this podcast"
              type="button"
            >
              <Mic size={18} />
              <span>Re-voice</span>
            </button>
          )}
          <button
            className={`${styles.actionBtn} ${saved ? styles.actionBtnActive : ''}`}
            onClick={handleSave}
            aria-label={saved ? 'Unsave' : 'Save'}
            aria-pressed={saved}
            type="button"
          >
            <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>
          <ShareMenu
            podcastId={podcast.id}
            podcastTitle={podcast.title}
            slug={podcast.slug}
            handle={podcast.user.handle}
            isPublic={podcast.visibility === 'PUBLIC'}
            triggerClassName={styles.actionBtn}
          />

          {/* Overflow menu — secondary actions */}
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
                ...(isAuthenticated ? [{
                  icon: <ListMusic size={16} />,
                  label: 'Add to Collection',
                  onClick: () => setShowAddToCollection(true),
                }] : []),
                ...(isOwner ? [{
                  icon: <BarChart2 size={16} />,
                  label: 'Analytics',
                  onClick: () => router.push(`/podcast/${podcast.id}/analytics`),
                }] : []),
                ...(isOwner ? [{
                  icon: <Pencil size={16} />,
                  label: 'Edit',
                  onClick: () => router.push(`/podcast/${podcast.id}/edit`),
                }] : []),
                ...(isReady && isAuthenticated ? [{
                  icon: pdfLoading ? <FileText size={16} /> : pdfUrl ? <Download size={16} /> : <FileText size={16} />,
                  label: pdfLoading ? 'Generating PDF...' : 'PDF Transcript',
                  onClick: handleExportPdf,
                }] : []),
                ...(isOwner && liveStatus !== 'FAILED' ? [{
                  icon: <Trash2 size={16} />,
                  label: 'Delete',
                  onClick: () => setShowDeleteConfirm(true),
                  danger: true,
                }] : []),
                ...(!isOwner && isAuthenticated ? [{
                  icon: <Flag size={16} />,
                  label: 'Report',
                  onClick: () => setShowReport(true),
                  danger: true,
                }] : []),
              ]}
            />
          )}
        </div>
      </div>

      {/* Contributors (from accepted re-voice proposals) */}
      {(() => {
        const contributorMap = new Map<string, { contributor: NonNullable<(typeof podcast.voiceTracks)[0]['contributor']>; count: number }>();
        for (const t of podcast.voiceTracks) {
          if (t.contributor && t.proposalStatus === 'ACCEPTED') {
            const existing = contributorMap.get(t.contributor.id);
            if (existing) {
              existing.count++;
            } else {
              contributorMap.set(t.contributor.id, { contributor: t.contributor, count: 1 });
            }
          }
        }
        const contributors = Array.from(contributorMap.values());
        return contributors.length > 0 ? <Contributors contributors={contributors} /> : null;
      })()}

      {/* Interrupt */}
      {isReady && isAuthenticated && (
        <div className={styles.interruptSection}>
          <InterruptButton onInterrupt={handleInterrupt} />
          <VoiceQABadge />
        </div>
      )}

      {/* Interrupt Chat */}
      {showInterruptChat && (
        <InterruptChatPanel
          podcastId={podcast.id}
          isOwner={isOwner}
          podcastSource={podcast.source}
          currentTime={currentTime}
          existingInteractions={podcast.interactions}
          onClose={() => setShowInterruptChat(false)}
          onQuestionAnswered={() => setQuestionsRefreshTrigger((n) => n + 1)}
        />
      )}

      {/* View Toggle + Transcript/Teleprompter */}
      {podcast.segments.length > 0 && (
        <>
          <div className={styles.viewToggle} role="tablist" aria-label="Transcript view mode">
            <button
              className={`${styles.viewToggleBtn} ${viewMode === 'transcript' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('transcript')}
              role="tab"
              aria-selected={viewMode === 'transcript'}
              type="button"
            >
              Transcript
            </button>
            <button
              className={`${styles.viewToggleBtn} ${viewMode === 'teleprompter' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('teleprompter')}
              role="tab"
              aria-selected={viewMode === 'teleprompter'}
              type="button"
            >
              Teleprompter
            </button>
            {segmentVisuals.length > 0 && (
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'video' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('video')}
                role="tab"
                aria-selected={viewMode === 'video'}
                type="button"
              >
                Video
              </button>
            )}
          </div>

          <section className={styles.transcriptSection}>
            {viewMode === 'transcript' ? (
              <TranscriptPanel
                segments={podcast.segments}
                references={podcast.references}
                currentTime={currentTime}
                onSegmentClick={handleSegmentClick}
                questionCounts={isOwner ? questionCounts : undefined}
                podcastId={podcast.id}
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
              />
            ) : null}
          </section>

          {podcast.references.length > 0 && (
            <section className={styles.referencesSection}>
              <ReferenceList references={podcast.references} />
            </section>
          )}
        </>
      )}

      {/* Community Questions */}
      {isReady && podcast.visibility === 'PUBLIC' && (
        <section className={styles.questionsSection}>
          <CommunityQuestions podcastId={podcast.id} refreshTrigger={questionsRefreshTrigger} />
        </section>
      )}

      {/* Comments */}
      {isReady && podcast.visibility === 'PUBLIC' && (
        <section className={styles.commentsSection}>
          <CommentSection
            podcastId={podcast.id}
            podcastOwnerId={podcast.user.id}
            currentUserId={currentUserId}
            commentCount={podcast.commentCount}
          />
        </section>
      )}

      {/* Version History */}
      {podcast.versions.length > 1 && (
        <section className={styles.versionSection}>
          <VersionHistory versions={podcast.versions} currentVersion={podcast.currentVersion} />
        </section>
      )}

      {/* Fork Lineage */}
      {(podcast.forkedFrom || podcast.forks.length > 0) && (
        <section className={styles.lineageSection}>
          {lineageData && lineageData.ancestors.length + lineageData.forks.length >= 3 ? (
            <ForkGraph
              ancestors={lineageData.ancestors}
              current={{
                id: podcast.id,
                title: podcast.title,
                user: { name: podcast.user.name, handle: podcast.user.handle ?? null },
              }}
              forks={lineageData.forks}
            />
          ) : (
            <ForkLineage
              ancestors={podcast.forkedFrom ? [podcast.forkedFrom] : []}
              forks={podcast.forks}
            />
          )}
        </section>
      )}

      {/* Verification mode badge */}
      {podcast.verificationMode === 'relaxed' && (
        <div className={styles.verificationBadge} title="This podcast uses relaxed fact-checking for opinion and creative content">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Lightly verified
        </div>
      )}

      {/* Made with Sotto */}
      {!isOwner && podcast.visibility === 'PUBLIC' && (
        <div className={styles.badgeSection}>
          <SottoBadge />
        </div>
      )}

      {/* Fork & Remix Modal */}
      <ForkRemixModal
        isOpen={showForkRemix}
        onClose={() => setShowForkRemix(false)}
        podcastId={podcast.id}
        podcastTitle={podcast.title}
      />

      {/* Re-voice Modal */}
      <VoiceRenditionForkModal
        isOpen={showReVoice}
        onClose={() => setShowReVoice(false)}
        podcastId={podcast.id}
        podcastTitle={podcast.title}
        speakers={[...new Set(podcast.segments.map(s => s.speaker))]}
      />

      {/* Add to Collection Modal */}
      <AddToCollectionModal
        podcastId={podcast.id}
        isOpen={showAddToCollection}
        onClose={() => setShowAddToCollection(false)}
      />
      {showReport && (
        <ReportModal
          targetType="podcast"
          targetId={podcast.id}
          onClose={() => setShowReport(false)}
          context={{ isHumanContent: podcast.isHumanContent, source: podcast.source }}
        />
      )}
    </div>

    {/* Sticky mini-player when main player scrolls out of view */}
    {isReady && podcast.audioUrl && !playerInView && (
      <MiniPlayer
        podcastTitle={podcast.title}
        onExpand={() => playerSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
      />
    )}
    </>
  );
}
