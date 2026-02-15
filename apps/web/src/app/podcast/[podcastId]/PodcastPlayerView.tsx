'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Heart,
  Bookmark,
  GitFork,
  Play,
  FileText,
  Download,
  Pencil,
  RefreshCw,
  ListMusic,
  Trash2,
} from 'lucide-react';
import { AudioPlayerProvider, usePlayer } from '@/components/providers/AudioPlayerProvider';
import { AudioPlayer } from '@/components/player/AudioPlayer';
import { TranscriptPanel } from '@/components/player/TranscriptPanel';
import { Teleprompter } from '@/components/player/Teleprompter';
import { ReferenceList } from '@/components/player/ReferenceList';
import { InterruptButton } from '@/components/player/InterruptButton';
import { InterruptChatPanel } from '@/components/player/InterruptChatPanel';
import { ForkAttribution } from '@/components/player/ForkAttribution';
import { ForkLineage } from '@/components/player/ForkLineage';
import { ForkGraph } from '@/components/player/ForkGraph';
import { ForkRemixModal } from '@/components/player/ForkRemixModal';
import { AddToCollectionModal } from '@/components/collections/AddToCollectionModal';
import { ShareMenu } from '@/components/player/ShareMenu';
import { VersionHistory } from '@/components/player/VersionHistory';
import { CommunityQuestions } from '@/components/player/CommunityQuestions';
import { CommentSection } from '@/components/player/CommentSection';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { PodcastDetail } from '@/types/podcast';
import type { PodcastStatus } from '@prisma/client';
import styles from './page.module.css';

interface PodcastPlayerViewProps {
  podcast: PodcastDetail;
  isOwner: boolean;
  isAuthenticated: boolean;
  currentUserId?: string;
}

type ViewMode = 'transcript' | 'teleprompter';

const statusVariants: Record<PodcastStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> =
  {
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
}: {
  onTimeUpdate: (time: number) => void;
  seekRef: React.MutableRefObject<((time: number) => void) | null>;
}) {
  const { currentTime, seek } = usePlayer();
  useEffect(() => {
    seekRef.current = seek;
  }, [seek, seekRef]);
  useEffect(() => {
    onTimeUpdate(currentTime);
  }, [currentTime, onTimeUpdate]);
  return null;
}

export function PodcastPlayerView({ podcast, isOwner, isAuthenticated, currentUserId }: PodcastPlayerViewProps) {
  const router = useRouter();
  const [liked, setLiked] = useState(podcast.isLiked);
  const [likeCount, setLikeCount] = useState(podcast.likeCount);
  const [saved, setSaved] = useState(podcast.isSaved);
  const [currentTime, setCurrentTime] = useState(0);
  const seekRef = useRef<((time: number) => void) | null>(null);
  const [showInterruptChat, setShowInterruptChat] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('transcript');
  const [pdfUrl, setPdfUrl] = useState<string | null>(podcast.pdfUrl);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showForkRemix, setShowForkRemix] = useState(false);
  const [showAddToCollection, setShowAddToCollection] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [questionCounts, setQuestionCounts] = useState<Map<number, number>>(new Map());
  const [lineageData, setLineageData] = useState<{
    ancestors: Array<{
      id: string;
      title: string;
      user: { name: string | null; handle: string | null };
    }>;
    descendants: Array<{
      id: string;
      title: string;
      user: { name: string | null; handle: string | null };
    }>;
  } | null>(null);

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
      const response = await fetch(`/api/podcasts/${podcast.id}/generate`, {
        method: 'POST',
      });
      if (response.ok) {
        window.location.reload();
      }
    } catch {
      setRetrying(false);
    }
  }, [podcast.id]);

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

  const isReady = podcast.status === 'READY';
  const isProcessing = !isReady && podcast.status !== 'FAILED';

  return (
    <AudioPlayerProvider>
    <PlayerBridge onTimeUpdate={setCurrentTime} seekRef={seekRef} />
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
          <Link href={`/profile/${podcast.user.id}`} className={styles.creator}>
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
                  {(podcast.user.name || '?')[0].toUpperCase()}
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
          {podcast.status !== 'READY' && (
            <Badge variant={statusVariants[podcast.status as PodcastStatus]}>
              {podcast.status.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>

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
      {podcast.status === 'FAILED' && isOwner && (
        <div className={styles.failedState}>
          <p className={styles.failedText}>Generation failed. You can retry or delete this podcast.</p>
          <div className={styles.failedActions}>
            <Button onClick={handleRetry} loading={retrying} disabled={retrying || deleting}>
              <RefreshCw size={16} />
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
          <div className={styles.processingSpinner} aria-hidden="true" />
          <p className={styles.processingText}>
            Your podcast is being generated. This page will update automatically when it is ready.
          </p>
        </div>
      )}

      {/* Player */}
      {isReady && podcast.audioUrl && (
        <section className={styles.playerSection} aria-label="Audio player">
          <AudioPlayer podcastId={podcast.id} audioUrl={podcast.audioUrl!} />
        </section>
      )}

      {/* Stats & Actions */}
      <div className={styles.actionsRow}>
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

        <div className={styles.actionButtons}>
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
          {isAuthenticated && (
            <button
              className={styles.actionBtn}
              onClick={() => setShowAddToCollection(true)}
              aria-label="Add to collection"
              type="button"
            >
              <ListMusic size={18} />
              <span>Collect</span>
            </button>
          )}
          {isOwner && (
            <Link
              href={`/podcast/${podcast.id}/edit`}
              className={styles.actionBtn}
              aria-label="Edit this podcast"
            >
              <Pencil size={18} />
              <span>Edit</span>
            </Link>
          )}
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
          <ShareMenu
            podcastId={podcast.id}
            podcastTitle={podcast.title}
            audioUrl={podcast.audioUrl}
            isPublic={podcast.visibility === 'PUBLIC'}
          />
          {isReady && isAuthenticated && (
            <button
              className={styles.actionBtn}
              onClick={handleExportPdf}
              aria-label={pdfUrl ? 'Download PDF transcript' : 'Generate PDF transcript'}
              disabled={pdfLoading}
              type="button"
            >
              {pdfLoading ? (
                <>
                  <FileText size={18} />
                  <span>Generating...</span>
                </>
              ) : pdfUrl ? (
                <>
                  <Download size={18} />
                  <span>PDF</span>
                </>
              ) : (
                <>
                  <FileText size={18} />
                  <span>PDF</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Interrupt */}
      {isReady && isAuthenticated && (
        <div className={styles.interruptSection}>
          <InterruptButton onInterrupt={handleInterrupt} />
        </div>
      )}

      {/* Interrupt Chat */}
      {showInterruptChat && (
        <InterruptChatPanel
          podcastId={podcast.id}
          isOwner={isOwner}
          currentTime={currentTime}
          existingInteractions={podcast.interactions}
          onClose={() => setShowInterruptChat(false)}
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
          </div>

          <section className={styles.transcriptSection}>
            {viewMode === 'transcript' ? (
              <TranscriptPanel
                segments={podcast.segments}
                references={podcast.references}
                currentTime={currentTime}
                onSegmentClick={handleSegmentClick}
                questionCounts={isOwner ? questionCounts : undefined}
              />
            ) : (
              <Teleprompter
                segments={podcast.segments}
                references={podcast.references}
                currentTime={currentTime}
                onSegmentClick={handleSegmentClick}
              />
            )}
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
          <CommunityQuestions podcastId={podcast.id} />
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
          {lineageData && lineageData.ancestors.length + lineageData.descendants.length >= 3 ? (
            <ForkGraph
              ancestors={lineageData.ancestors}
              current={{
                id: podcast.id,
                title: podcast.title,
                user: { name: podcast.user.name, handle: podcast.user.handle ?? null },
              }}
              forks={lineageData.descendants}
            />
          ) : (
            <ForkLineage
              ancestors={podcast.forkedFrom ? [podcast.forkedFrom] : []}
              forks={podcast.forks}
            />
          )}
        </section>
      )}

      {/* Fork & Remix Modal */}
      <ForkRemixModal
        isOpen={showForkRemix}
        onClose={() => setShowForkRemix(false)}
        podcastId={podcast.id}
        podcastTitle={podcast.title}
      />

      {/* Add to Collection Modal */}
      <AddToCollectionModal
        podcastId={podcast.id}
        isOpen={showAddToCollection}
        onClose={() => setShowAddToCollection(false)}
      />
    </div>
    </AudioPlayerProvider>
  );
}
