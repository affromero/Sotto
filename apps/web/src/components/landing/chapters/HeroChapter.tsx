import type { LandingShowcaseData } from '@/lib/showcase';
import { BRAND } from '@sotto/shared';
import { ScrollChapter } from '../ScrollChapter';
import { AuthCTA } from '../AuthCTA';
import { AudioClipPlayer } from './AudioClipPlayer';
import styles from './HeroChapter.module.css';

const DEMO_TRANSCRIPT_SEGMENTS = [
  { id: 'demo-seg-1', order: 0, speaker: 'HOST', text: 'Today\'s top story — the latest [V1:Nachrichten] from the global [V2:Wirtschaft] summit.', startTime: 0, duration: 8 },
  { id: 'demo-seg-2', order: 1, speaker: 'EXPERT', text: 'The [V3:Verhandlungen] between trade ministers produced a new [V4:Bericht] on climate targets.', startTime: 8, duration: 10 },
];

interface HeroChapterProps {
  showcase: LandingShowcaseData | null;
}

export function HeroChapter({ showcase }: HeroChapterProps) {
  const vocabSegments = showcase?.clipVocabulary ? showcase.clipSegments : DEMO_TRANSCRIPT_SEGMENTS;

  return (
    <ScrollChapter dark>
      <div className={styles.root}>
        <div className={styles.content}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            {BRAND.tagline}
          </div>

          <h1 className={styles.title}>
            Your agent. Your context.
            <br />
            <em>Now it can teach you.</em>
          </h1>

          <p className={styles.subtitle}>
            Connect your own Claude or Codex and the context you choose to share. Sotto builds a language course around your work and interests.
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
                clipSegments={vocabSegments}
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
