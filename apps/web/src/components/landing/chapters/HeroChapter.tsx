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

          <p className={styles.subtitle}>
            Describe what you want to learn. Sotto writes a fact-checked script,
            generates studio audio from 7 voice providers, and turns it into video.
          </p>

          <AuthCTA source="hero" />

          {showcase && (
            <div className={styles.showcase}>
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
      </div>
    </ScrollChapter>
  );
}
