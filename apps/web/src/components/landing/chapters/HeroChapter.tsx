import { BRAND } from '@sotto/shared';
import { ScrollChapter } from '../ScrollChapter';
import { AuthCTA } from '../AuthCTA';
import styles from './HeroChapter.module.css';

export function HeroChapter() {
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
            Describe what you want to learn. Sotto writes a fact-checked script,
            generates studio audio from 7 voice providers, and turns it into video.
          </p>

          <AuthCTA source="hero" />
        </div>
      </div>
    </ScrollChapter>
  );
}
