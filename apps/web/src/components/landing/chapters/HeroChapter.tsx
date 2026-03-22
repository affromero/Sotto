import type { LandingShowcaseData } from '@/lib/showcase';
import { BRAND } from '@sotto/shared';
import { ScrollChapter } from '../ScrollChapter';
import { AuthCTA } from '../AuthCTA';
import { AudioClipPlayer } from './AudioClipPlayer';
import styles from './HeroChapter.module.css';

interface HeroChapterProps {
  showcase: LandingShowcaseData | null;
}

export function HeroChapter({ showcase }: HeroChapterProps) {
  return (
    <ScrollChapter dark>
      <div className={styles.root}>
        <div className={styles.content}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            {BRAND.tagline}
          </div>

          <h1 className={styles.title}>
            Any topic.
            <br />
            <em>Studio-quality podcast.</em>
          </h1>

          <p className={styles.subtitle}>
            Describe what you want to hear. Sotto writes, voices, and films it.
          </p>

          <AuthCTA source="hero" />
        </div>

        <div className={styles.visual}>
          {showcase ? (
            <>
              <AudioClipPlayer
                title={showcase.podcast.title}
                voiceCount={showcase.voiceCount}
                sourceCount={showcase.sourceCount}
                audioUrl={showcase.audioClip.url}
                originalTrackName={showcase.originalTrackName}
                startTime={showcase.audioClip.start}
                endTime={showcase.audioClip.end}
                totalDuration={showcase.audioClip.totalDuration}
                podcastId={showcase.podcast.podcastId}
                voiceTracks={showcase.voiceTracks}
                videoClip={showcase.videoClip}
                clipSegments={showcase.clipSegments}
                clipVisuals={showcase.clipVisuals}
                showVideoToggle={showcase.showVideo}
              />
              <div className={styles.proof}>
                <span>{showcase.voiceCount} voices</span>
                <span aria-hidden="true" className={styles.proofDot} />
                <span>{showcase.sourceCount} sources</span>
              </div>
            </>
          ) : (
            <div className={styles.waveformFallback} aria-hidden="true">
              <div className={styles.waveformBars}>
                {Array.from({ length: 32 }, (_, i) => (
                  <span
                    key={i}
                    className={styles.waveformBar}
                    style={{ '--i': i } as React.CSSProperties}
                  />
                ))}
              </div>
              <a href="/create" className={styles.waveformCta}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Create your first podcast
              </a>
            </div>
          )}
        </div>
      </div>
    </ScrollChapter>
  );
}
