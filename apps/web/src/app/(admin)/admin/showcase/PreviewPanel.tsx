'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import styles from './PreviewPanel.module.css';

interface SegmentVisual {
  id: string;
  segmentId: string;
  visualType: string;
  prompt: string | null;
  status: string;
  assetUrl: string | null;
  order: number;
}

interface VideoData {
  videoGenerationId: string;
  status: string;
  videoUrl: string | null;
  duration: number | null;
  avatarsVisible: boolean;
  segmentVisuals: SegmentVisual[];
}

interface PreviewPanelProps {
  podcastId: string;
  onVisibilityChange?: (visibility: string) => void;
}

export function PreviewPanel({ podcastId, onVisibilityChange }: PreviewPanelProps) {
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [visibility, setVisibility] = useState<string>('PRIVATE');
  const [audioOnly, setAudioOnly] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Fetch video generation data
  const fetchVideo = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`);
      if (!res.ok) {
        setStatus('idle');
        return;
      }
      const data = await res.json();
      setVideoData(data);
      setStatus('idle');
    } catch {
      setStatus('error');
      setMessage('Failed to load video data');
    }
  }, [podcastId]);

  // Fetch podcast visibility
  const fetchPodcast = useCallback(async () => {
    try {
      const res = await fetch(`/api/podcasts/${podcastId}`);
      if (!res.ok) return;
      const data = await res.json();
      setVisibility(data.visibility ?? 'PRIVATE');
    } catch {
      // Non-critical
    }
  }, [podcastId]);

  useEffect(() => {
    fetchVideo();
    fetchPodcast();
  }, [fetchVideo, fetchPodcast]);

  // Update visibility
  const updateVisibility = useCallback(async (newVisibility: string) => {
    setStatus('saving');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Update failed');
      }
      setVisibility(newVisibility);
      setMessage(`Visibility set to ${newVisibility.toLowerCase()}`);
      setStatus('idle');
      onVisibilityChange?.(newVisibility);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
      setStatus('error');
    }
  }, [podcastId, onVisibilityChange]);

  // Copy URL to clipboard
  const copyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(
      () => { setMessage('Copied to clipboard'); setStatus('idle'); },
      () => { setMessage('Copy failed'); setStatus('error'); },
    );
  }, []);

  const hasVideo = videoData?.videoUrl && videoData.status === 'READY';
  const podcastUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/podcast/${podcastId}`;
  const embedUrl = `${podcastUrl}/embed`;

  return (
    <div className={styles.root}>
      {/* Video / Audio player */}
      <div className={styles.playerSection}>
        {hasVideo && !audioOnly ? (
          <video
            ref={videoRef}
            className={styles.videoPlayer}
            src={videoData.videoUrl!}
            controls
            preload="metadata"
          >
            <track kind="captions" />
          </video>
        ) : (
          <div className={styles.audioFallback}>
            <p className={styles.audioLabel}>
              {hasVideo ? 'Audio-only mode' : 'No video available yet'}
            </p>
            {/* Audio player uses the podcast page which handles audio */}
            <audio
              ref={audioRef}
              className={styles.audioPlayer}
              src={`/api/podcasts/${podcastId}/download`}
              controls
              preload="metadata"
            />
          </div>
        )}

        {/* Player controls */}
        {hasVideo && (
          <div className={styles.playerControls}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={audioOnly}
                onChange={(e) => setAudioOnly(e.target.checked)}
              />
              Audio only
            </label>
            {videoData.duration && (
              <span className={styles.metaText}>
                {Math.floor(videoData.duration / 60)}:{String(videoData.duration % 60).padStart(2, '0')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Segment visual timeline */}
      {videoData?.segmentVisuals && videoData.segmentVisuals.length > 0 && (
        <fieldset className={styles.timelineFieldset}>
          <legend className={styles.timelineLegend}>Segment Visuals</legend>
          <div className={styles.timeline}>
            {videoData.segmentVisuals.map((sv) => (
              <div key={sv.id} className={styles.timelineItem} data-status={sv.status}>
                <span className={styles.timelineOrder}>#{sv.order}</span>
                <span className={styles.timelineType}>{sv.visualType.replace(/_/g, ' ')}</span>
                <span className={styles.timelineStatus}>{sv.status}</span>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {/* Publish controls */}
      <fieldset className={styles.publishFieldset}>
        <legend className={styles.publishLegend}>Publish</legend>

        <div className={styles.visibilityRow}>
          <label className={styles.visibilityLabel}>Visibility</label>
          <select
            className={styles.visibilitySelect}
            value={visibility}
            onChange={(e) => updateVisibility(e.target.value)}
            disabled={status === 'saving'}
          >
            <option value="PUBLIC">Public</option>
            <option value="UNLISTED">Unlisted</option>
            <option value="PRIVATE">Private</option>
          </select>
        </div>

        <div className={styles.linkRow}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => copyUrl(podcastUrl)}
          >
            Copy Link
          </button>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => copyUrl(embedUrl)}
          >
            Copy Embed URL
          </button>
          {hasVideo && (
            <a
              href={videoData.videoUrl!}
              download
              className={styles.linkBtn}
            >
              Download Video
            </a>
          )}
        </div>

        {visibility === 'PUBLIC' && (
          <p className={styles.publishedNote}>
            This podcast is live on the feed.
          </p>
        )}
      </fieldset>

      {message && (
        <div
          className={styles.banner}
          data-variant={status === 'error' ? 'error' : 'success'}
          role="alert"
        >
          {message}
        </div>
      )}
    </div>
  );
}
