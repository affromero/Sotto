import { BRAND } from '@sotto/shared';
import { ScrollChapter } from '../ScrollChapter';
import { AuthCTA } from '../AuthCTA';
import { EmbedPlayer } from '@/components/player/EmbedPlayer';
import { getShowcasePodcast } from '@/lib/showcase';
import styles from './HeroChapter.module.css';

export async function HeroChapter() {
  const showcase = await getShowcasePodcast();

  return (
    <ScrollChapter dark>
      <div className={styles.root}>
        <div className={styles.glow} aria-hidden="true" />
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

          {/* Video demo slot — placeholder until user provides video */}
          <div className={styles.videoSlot}>
            <div className={styles.videoPlaceholder}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={styles.playIcon}
              >
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              <span className={styles.videoLabel}>Demo coming soon</span>
            </div>
          </div>

          <AuthCTA source="hero" />

          {showcase && (
            <div className={styles.showcase}>
              <span className={styles.showcaseLabel}>Listen to a sample podcast</span>
              <EmbedPlayer
                podcastId={showcase.podcastId}
                title={showcase.title}
                creatorName={showcase.creatorName}
                audioUrl={showcase.audioUrl}
                duration={showcase.duration}
              />
            </div>
          )}
        </div>

        <div className={styles.wave} aria-hidden="true">
          {Array.from({ length: 48 }, (_, i) => (
            <span key={i} className={styles.bar} style={{ '--i': i } as React.CSSProperties} />
          ))}
        </div>
      </div>
    </ScrollChapter>
  );
}
