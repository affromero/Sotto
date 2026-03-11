import { ScrollChapter } from '../ScrollChapter';
import { PoweredByProviders } from '../PoweredByProviders';
import styles from './NetworkChapter.module.css';

const FEATURES = [
  {
    title: 'Fork & Remix',
    description:
      'Found a podcast you love? Fork it. Change the angle, swap voices, go deeper on a subtopic. Credit always links back to the original.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="7" cy="5" r="3" />
        <circle cx="7" cy="19" r="3" />
        <circle cx="19" cy="12" r="3" />
        <path d="M7 8v8M10 19h6a3 3 0 0 0 0-6h-6" />
      </svg>
    ),
  },
  {
    title: 'Import Any Podcast',
    description:
      'Bring podcasts from NotebookLM, Spotify, Apple Podcasts, YouTube, or any audio file. Sotto adds transcripts, social features, and interactive Q&A.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
  {
    title: 'Ask Questions Live',
    description:
      "Pause mid-playback to ask a follow-up. Get an answer drawn from the full context. Your Q&A gets woven back into the episode permanently.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export function NetworkChapter() {
  return (
    <ScrollChapter id="voices" alt>
      <div className={styles.root}>
        <div className={styles.header} data-reveal>
          <span className={styles.overline}>Community</span>
          <h2 className={styles.heading}>Fork, import, remix</h2>
          <p className={styles.description}>
            Sotto is a social podcast network. Build on what others started, bring in
            podcasts from anywhere, and interact with every episode.
          </p>
        </div>

        <div className={styles.cards}>
          {FEATURES.map((feature, i) => (
            <article
              key={feature.title}
              className={styles.card}
              data-reveal
              style={{ '--reveal-index': i } as React.CSSProperties}
            >
              <div className={`${styles.cardIcon} ${i === 1 ? styles.cardIconNavy : ''}`}>
                {feature.icon}
              </div>
              <h3 className={styles.cardTitle}>{feature.title}</h3>
              <p className={styles.cardDesc}>{feature.description}</p>
            </article>
          ))}
        </div>

        <div className={styles.providers} data-reveal>
          <PoweredByProviders />
        </div>
      </div>
    </ScrollChapter>
  );
}
