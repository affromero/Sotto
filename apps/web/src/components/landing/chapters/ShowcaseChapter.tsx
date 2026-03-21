'use client';

import { useState, useEffect } from 'react';
import type { LandingShowcaseData } from '@/lib/showcase';
import { useShowcaseToggles } from '../ShowcaseTogglesProvider';
import { ScrollChapter } from '../ScrollChapter';
import styles from './ShowcaseChapter.module.css';

interface ShowcaseChapterProps {
  showcase: LandingShowcaseData | null;
}

interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  url: string;
  mediaType: 'image' | 'video';
  credits?: string;
}

const DEFAULT_SEGMENTS = [
  { num: 1, label: 'CRISPR molecular scissors', type: 'AI Illustration', colorClass: 'purple' },
  { num: 2, label: 'Gene therapy success rates', type: 'Data Chart', colorClass: 'amber' },
  { num: 3, label: 'Laboratory research setting', type: 'Stock Footage', colorClass: 'navy' },
  { num: 4, label: 'Key milestones in gene editing', type: 'Timeline', colorClass: 'green' },
] as const;

const COLOR_CYCLE = ['purple', 'amber', 'navy', 'green'] as const;

const COLOR_MAP: Record<string, string> = {
  purple: styles.badgePurple,
  amber: styles.badgeAmber,
  navy: styles.badgeNavy,
  green: styles.badgeGreen,
};

export function ShowcaseChapter({ showcase }: ShowcaseChapterProps) {
  const toggles = useShowcaseToggles();
  const videoEnabled = toggles?.videoEnabled ?? false;
  const avatarEnabled = toggles?.avatarEnabled ?? false;
  const showVideoToggle = showcase?.showVideo ?? false;
  const showAvatarToggle = (showcase?.showAvatar && showcase?.hasAvatars) ?? false;

  const [showcaseItems, setShowcaseItems] = useState<ShowcaseItem[] | null>(null);

  useEffect(() => {
    fetch('/api/showcase')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.items?.length > 0) {
          setShowcaseItems(data.items);
        }
      })
      .catch(() => {});
  }, []);

  // If we have showcase clips, show the visual grid instead of the mock
  if (showcaseItems && showcaseItems.length > 0) {
    return (
      <ScrollChapter id="video">
        <div className={styles.root}>
          <div className={styles.showcaseHeader}>
            <span className={styles.overline}>Video generation</span>
            <h2 className={styles.heading}>Turn podcasts into video</h2>
            <p className={styles.description}>
              Choose from 11 visual types — AI illustrations, data charts,
              source figures, maps, stock footage, timelines, and more.
              Fully customizable per segment.
            </p>
          </div>
          <div className={styles.showcaseGrid}>
            {showcaseItems.map((item) => (
              <div key={item.visualType} className={styles.showcaseCard}>
                <div className={styles.showcaseMedia}>
                  {item.mediaType === 'video' ? (
                    <video
                      src={item.url}
                      className={styles.showcaseVideo}
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={item.url}
                      alt={item.label}
                      className={styles.showcaseVideo}
                    />
                  )}
                  {item.credits && (
                    <span className={styles.showcaseCredits}>{item.credits}</span>
                  )}
                </div>
                <div className={styles.showcaseCardBody}>
                  <span className={styles.showcaseType}>{item.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollChapter>
    );
  }

  // Fallback: original mock pipeline card
  const segments = showcase && showcase.videoSegments.length > 0
    ? showcase.videoSegments.map((seg, i) => ({
        num: seg.order,
        label: seg.label,
        type: seg.type,
        colorClass: COLOR_CYCLE[i % COLOR_CYCLE.length],
      }))
    : DEFAULT_SEGMENTS;

  return (
    <ScrollChapter id="video">
      <div className={styles.root}>
        <div className={`${styles.split} ${styles.splitReverse}`} data-reveal>
          <div className={styles.splitVisual}>
            <div className={styles.mockVideo}>
              <div className={styles.mockHeader}>
                <div className={styles.mockDot} aria-hidden="true" />
                <span>Video Pipeline</span>
              </div>
              <div className={styles.mockBody}>
                {segments.map((seg, i) => (
                  <div key={i} className={styles.segment}>
                    <span className={styles.segNum}>{seg.num}</span>
                    <span className={styles.segLabel}>{seg.label}</span>
                    <span className={`${styles.segBadge} ${COLOR_MAP[seg.colorClass]}`}>
                      {seg.type}
                    </span>
                  </div>
                ))}
                <div className={styles.videoFooter}>
                {showVideoToggle && (
                  <button
                    type="button"
                    className={styles.toggle}
                    onClick={() => toggles?.setVideoEnabled(!videoEnabled)}
                    aria-pressed={videoEnabled}
                    aria-label={`Video: ${videoEnabled ? 'On' : 'Off'}`}
                  >
                    <span className={`${styles.toggleTrack} ${videoEnabled ? styles.toggleTrackOn : ''}`}>
                      <span className={styles.toggleKnob} />
                    </span>
                    Video: {videoEnabled ? 'On' : 'Off'}
                  </button>
                )}
                {showAvatarToggle && (
                  <button
                    type="button"
                    className={styles.toggle}
                    onClick={() => toggles?.setAvatarEnabled(!avatarEnabled)}
                    aria-pressed={avatarEnabled}
                    aria-label={`Avatars: ${avatarEnabled ? 'On' : 'Off'}`}
                  >
                    <span className={`${styles.toggleTrack} ${avatarEnabled ? styles.toggleTrackOn : ''}`}>
                      <span className={styles.toggleKnob} />
                    </span>
                    Avatars: {avatarEnabled ? 'On' : 'Off'}
                  </button>
                )}
                  <span className={styles.videoCount}>11 visual types</span>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.splitText}>
            <div className={styles.textContent}>
              <span className={styles.overline}>Video generation</span>
              <h2 className={styles.heading}>Turn podcasts into video</h2>
              <p className={styles.description}>
                Every segment gets a visual. AI illustrations, maps,
                data charts, stock footage, timelines, diagrams, and more.
                Add avatar presenters or keep it clean. Eleven visual types, fully automatic.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ScrollChapter>
  );
}
