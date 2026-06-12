'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEpisodeStatus } from '@/lib/hooks/useEpisodeStatus';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  FileText,
  Download,
  Pencil,
  RefreshCw,
  Trash2,
  Shield,
  MessageCircleQuestion,
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
import type { EpisodeDetail } from '@/types/episode';
import type { EpisodeStatus } from '@prisma/client';
import styles from './page.module.css';

interface EpisodePlayerViewProps {
  episode: EpisodeDetail;
  isOwner: boolean;
  isAdmin?: boolean;
  isAuthenticated: boolean;
}

type ViewMode = 'transcript' | 'teleprompter';

const statusVariants: Record<EpisodeStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> =
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
  };

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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

export function EpisodePlayerView({
  episode,
  isOwner,
  isAdmin,
  isAuthenticated,
}: EpisodePlayerViewProps) {
  const router = useRouter();
  const [currentTime, setCurrentTime] = useState(0);
  const seekRef = useRef<((time: number) => void) | null>(null);
  const [showInterruptChat, setShowInterruptChat] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('transcript');
  const [pdfUrl, setPdfUrl] = useState<string | null>(episode.pdfUrl);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState(episode.status);
  const [liveFailureReason, setLiveFailureReason] = useState(episode.failureReason);
  const [liveFailedAtStatus, setLiveFailedAtStatus] = useState(episode.failedAtStatus);
  const [liveErrorId, setLiveErrorId] = useState(episode.errorId);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [scriptTurns, setScriptTurns] = useState<Array<{ speaker: string; text: string }> | null>(
    null
  );
  const [lowReferences, setLowReferences] = useState(false);
  const [requiredRefCount, setRequiredRefCount] = useState(0);
  const [verificationProgress, setVerificationProgress] = useState<Record<string, unknown> | null>(
    ('verificationProgress' in episode
      ? (episode as { verificationProgress?: Record<string, unknown> | null }).verificationProgress
      : null) ?? null
  );
  const [audioConfig, setAudioConfig] = useState<AudioConfig>({ voices: [] });
  const playerSectionRef = useRef<HTMLElement>(null);

  // Fetch script turns for review when SCRIPT_READY or FAILED (for AudioConfigPanel speakers)
  const needsScript =
    liveStatus === 'SCRIPT_READY' ||
    (liveStatus === 'FAILED' &&
      ['GENERATING_AUDIO', 'STITCHING'].includes(liveFailedAtStatus ?? ''));
  useEffect(() => {
    if (!needsScript || !isOwner) return;
    fetch(`/api/v1/episodes/${episode.id}/script`)
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
  }, [needsScript, isOwner, episode.id]);

  // SSE-based status watching while episode is processing
  const isStillProcessing =
    liveStatus !== 'READY' && liveStatus !== 'FAILED' && liveStatus !== 'SCRIPT_READY';
  useEpisodeStatus({
    episodeId: isStillProcessing ? episode.id : null,
    initialStatus: liveStatus,
    onStatusChange: useCallback(
      (event: { status: string; [key: string]: unknown }) => {
        setLiveStatus(event.status as typeof episode.status);
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
      // `episode` appears only in a `typeof` type cast above (no runtime use), so it is not a real dependency.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [router]
    ),
  });

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
      const response = await fetch(`/api/v1/episodes/${episode.id}/generate`, {
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
  }, [episode.id, audioConfig]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/v1/episodes/${episode.id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        router.push('/dashboard');
      }
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [episode.id, router]);

  const handleExportPdf = useCallback(async () => {
    if (!isAuthenticated) return;

    // If PDF already available, open it
    if (pdfUrl) {
      window.open(pdfUrl, '_blank');
      return;
    }

    setPdfLoading(true);
    try {
      const response = await fetch(`/api/v1/episodes/${episode.id}/export`, {
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
          const pollResponse = await fetch(`/api/v1/episodes/${episode.id}/export`);
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
  }, [isAuthenticated, episode.id, pdfUrl]);

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
    if (isReady && episode.audioUrl) {
      document.body.setAttribute('data-mini-player', '');
    }
    return () => document.body.removeAttribute('data-mini-player');
  }, [isReady, episode.audioUrl]);

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

        {/* Episode Info */}
        <header className={styles.episodeHeader}>
          <h1 className={styles.episodeTitle}>{episode.title}</h1>

          {episode.topic && <p className={styles.episodeDescription}>{episode.topic}</p>}

          <div className={styles.metaRow}>
            <div className={styles.creator}>
              <div className={styles.creatorAvatar}>
                {episode.user.image ? (
                  <Image
                    src={episode.user.image}
                    alt={episode.user.name || 'Creator'}
                    width={32}
                    height={32}
                    className={styles.creatorAvatarImg}
                  />
                ) : (
                  <span className={styles.creatorAvatarFallback}>
                    {(episode.user.name || episode.user.handle || 'U')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <span className={styles.creatorName}>{episode.user.name || 'Anonymous'}</span>
            </div>
            <span className={styles.metaDot} aria-hidden="true" />
            <time className={styles.metaDate} dateTime={episode.createdAt}>
              {formatDate(episode.createdAt)}
            </time>
            {episode.duration && (
              <>
                <span className={styles.metaDot} aria-hidden="true" />
                <span className={styles.metaDuration}>{formatDuration(episode.duration)}</span>
              </>
            )}
            {liveStatus !== 'READY' && (
              <Badge variant={statusVariants[liveStatus as EpisodeStatus]}>
                {liveStatus.replace(/_/g, ' ')}
              </Badge>
            )}
            {isOwner && <VisibilityToggle episodeId={episode.id} visibility={episode.visibility} />}
          </div>

          <MetadataBadges episode={episode} />

          {episode.tags.length > 0 && (
            <div className={styles.tags}>
              {episode.tags.map((tag) => (
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
                  {liveFailureReason || 'Generation failed.'} You can retry or delete this lesson.
                </p>
                {liveErrorId && (
                  <p className={styles.errorId}>
                    Error reference: <code>{liveErrorId}</code>
                  </p>
                )}
              </>
            )}
            {isAdmin && (
              <Link href={`/admin/episodes?search=${episode.id}`} className={styles.adminLink}>
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
                failedProvider={episode.ttsProvider}
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
              topic={episode.topic}
              verificationProgress={
                verificationProgress as
                  | import('@/types/episode').VerificationProgressSnapshot
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
              topic={episode.topic}
              verificationProgress={
                verificationProgress as
                  | import('@/types/episode').VerificationProgressSnapshot
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
                refCount={episode.references?.length ?? 0}
                requiredCount={requiredRefCount}
                episodeId={episode.id}
                onRegenerate={() => {
                  setLowReferences(false);
                  setLiveStatus('SCRIPTING');
                }}
                verificationProgress={
                  verificationProgress as
                    | import('@/types/episode').VerificationProgressSnapshot
                    | null
                }
              />
            )}
            <ScriptEditor
              episodeId={episode.id}
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

        {/* Player — immediately after owner tools */}
        {isReady && episode.audioUrl && (
          <section
            ref={playerSectionRef}
            className={styles.playerSection}
            aria-label="Audio player"
          >
            <AudioPlayer
              episodeId={episode.id}
              audioUrl={episode.audioUrl!}
              episodeTitle={episode.title}
            />
          </section>
        )}

        {/* Stats & Actions */}
        <div className={styles.actionsRow}>
          {isOwner && (
            <div className={styles.statsRow}>
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
                          onClick: () => router.push(`/episode/${episode.id}/edit`),
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
          const hasVersions = episode.versions.length > 1;
          const hasDetails = hasVersions;
          if (!hasDetails) return null;
          return (
            <details className={styles.detailsSection}>
              <summary className={styles.detailsSummary}>More details</summary>
              <div className={styles.detailsContent}>
                {hasVersions && (
                  <VersionHistory
                    versions={episode.versions}
                    currentVersion={episode.currentVersion}
                  />
                )}
              </div>
            </details>
          );
        })()}

        {/* View Toggle + Transcript/Teleprompter */}
        {episode.segments.length > 0 && (
          <details className={styles.detailsSection}>
            <summary className={styles.detailsSummary}>
              <div className={styles.viewToggle} role="tablist" aria-label="Transcript view mode">
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
                    segments={episode.segments}
                    references={episode.references}
                    vocabularyEntries={episode.vocabularyEntries}
                    currentTime={currentTime}
                    onSegmentClick={handleSegmentClick}
                  />
                ) : viewMode === 'teleprompter' ? (
                  <Teleprompter
                    segments={episode.segments}
                    references={episode.references}
                    currentTime={currentTime}
                    onSegmentClick={handleSegmentClick}
                  />
                ) : null}
              </section>
            </div>
          </details>
        )}

        {/* References — after transcript */}
        {episode.references.length > 0 && (
          <section className={styles.referencesSection}>
            <ReferenceList references={episode.references} />
          </section>
        )}

        {/* Vocabulary — after references (language learning episodes) */}
        {episode.vocabularyEntries && episode.vocabularyEntries.length > 0 && (
          <section className={styles.referencesSection}>
            <VocabularyList vocabularyEntries={episode.vocabularyEntries} />
          </section>
        )}

        {/* Interrupt Chat (opened from action bar) */}
        {showInterruptChat && (
          <InterruptChatPanel
            episodeId={episode.id}
            isOwner={isOwner}
            episodeSource={episode.source}
            currentTime={currentTime}
            existingInteractions={episode.interactions}
            onClose={() => setShowInterruptChat(false)}
          />
        )}

        {/* Verification mode badge */}
        {episode.verificationMode === 'relaxed' && (
          <div
            className={styles.verificationBadge}
            title="This lesson uses relaxed fact-checking at the creator's request. Claims may not be fully sourced."
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

        {episode.lowReferences && (
          <div
            className={styles.limitedSourcesBadge}
            aria-label="Limited Sources"
            title="This lesson has fewer verified references than recommended. Some claims may not be backed by cited sources."
          >
            <AlertTriangle size={14} aria-hidden="true" />
            Limited Sources ({episode.references.length} verified)
          </div>
        )}

        {/* Made with Sotto */}
        {!isOwner && episode.visibility === 'PUBLIC' && (
          <div className={styles.badgeSection}>
            <SottoBadge />
          </div>
        )}

      </div>

      {/* Persistent footer mini-player */}
      {isReady && episode.audioUrl && (
        <MiniPlayer
          episodeTitle={episode.title}
          onExpand={() => playerSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
        />
      )}
    </>
  );
}
